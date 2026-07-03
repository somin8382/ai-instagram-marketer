// Vercel serverless functions reject request bodies over ~4.5MB with a
// plain-text 413 before the route handler runs, so payload size must be
// controlled on the client.
const MAX_IMAGE_DIMENSION = 1536;
const JPEG_QUALITY = 0.85;
const MAX_AI_REQUEST_BYTES = 4_000_000;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("이미지 업로드에 실패했습니다."));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    img.src = src;
  });
}

export async function compressImageToDataUrl(
  source: Blob | string
): Promise<string> {
  const originalDataUrl =
    typeof source === "string" ? source : await blobToDataUrl(source);

  try {
    const img = await loadImageElement(originalDataUrl);
    const width = img.naturalWidth;
    const height = img.naturalHeight;

    if (!width || !height) {
      return originalDataUrl;
    }

    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const context = canvas.getContext("2d");

    if (!context) {
      return originalDataUrl;
    }

    // JPEG has no alpha channel; flatten onto white instead of black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);

    const compressed = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return compressed.length < originalDataUrl.length
      ? compressed
      : originalDataUrl;
  } catch {
    return originalDataUrl;
  }
}

export function isRequestBodyTooLarge(body: string): boolean {
  return new Blob([body]).size > MAX_AI_REQUEST_BYTES;
}

export async function readAiJsonResponse(res: Response) {
  const text = await res.text();

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function getAiErrorMessage(
  res: Response,
  data: unknown,
  fallback: string
): string {
  const error =
    data && typeof data === "object" && "error" in data ? data.error : null;

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (res.status === 413) {
    return "요청 용량이 너무 큽니다. 더 작은 이미지로 다시 시도해주세요.";
  }

  return fallback;
}
