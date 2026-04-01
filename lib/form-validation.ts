export type ValidationIssue<Field extends string = string> = {
  field: Field;
  message: string;
};

export type RequiredValidationRule<Field extends string> = {
  field: Field;
  message: string;
  isMissing: boolean;
};

export type ApplicationValidationField =
  | "selectedPlan"
  | "selectedDuration"
  | "instagramId"
  | "industry"
  | "productService"
  | "managerName"
  | "phone"
  | "email"
  | "depositorName"
  | "completionDate";

export type GeneratedPostPersistenceField =
  | "title"
  | "content"
  | "hashtags"
  | "imageUrl";

export function isBlank(value?: string | null) {
  return !value?.trim();
}

export function collectValidationIssues<Field extends string>(
  rules: RequiredValidationRule<Field>[]
) {
  return rules
    .filter((rule) => rule.isMissing)
    .map(({ field, message }) => ({ field, message }));
}

export function getFirstValidationIssue<Field extends string>(
  issues: ValidationIssue<Field>[]
) {
  return issues[0] ?? null;
}

export function getFieldError<Field extends string>(
  issues: ValidationIssue<Field>[],
  field: Field,
  touchedFields: Partial<Record<Field, boolean>>
) {
  if (!touchedFields[field]) {
    return undefined;
  }

  return issues.find((issue) => issue.field === field)?.message;
}

export function getIssueFields<Field extends string>(
  issues: ValidationIssue<Field>[]
) {
  return [...new Set(issues.map((issue) => issue.field))];
}

export function isValidPlanSelection(value?: number | null): value is 1 | 2 {
  return value === 1 || value === 2;
}

export function isValidDurationSelection(value?: number | null): value is 1 | 2 {
  return value === 1 || value === 2;
}

export function getApplicationValidationIssues(input: {
  selectedPlan?: number | null;
  selectedDuration?: number | null;
  instagramId?: string | null;
  industry?: string | null;
  productService?: string | null;
  managerName?: string | null;
  phone?: string | null;
  email?: string | null;
  depositorName?: string | null;
  isExpress?: boolean | null;
  completionDate?: string | null;
}) {
  return collectValidationIssues<ApplicationValidationField>([
    {
      field: "selectedPlan",
      message: "플랜을 선택해주세요",
      isMissing: !isValidPlanSelection(input.selectedPlan),
    },
    {
      field: "selectedDuration",
      message: "운영 기간을 선택해주세요",
      isMissing: !isValidDurationSelection(input.selectedDuration),
    },
    {
      field: "instagramId",
      message: "인스타그램 아이디를 입력해주세요",
      isMissing: isBlank(input.instagramId),
    },
    {
      field: "industry",
      message: "업종을 입력해주세요",
      isMissing: isBlank(input.industry),
    },
    {
      field: "productService",
      message: "판매하는 상품 또는 서비스를 입력해주세요",
      isMissing: isBlank(input.productService),
    },
    {
      field: "managerName",
      message: "담당자명을 입력해주세요",
      isMissing: isBlank(input.managerName),
    },
    {
      field: "phone",
      message: "연락처를 입력해주세요",
      isMissing: isBlank(input.phone),
    },
    {
      field: "email",
      message: "이메일을 입력해주세요",
      isMissing: isBlank(input.email),
    },
    {
      field: "depositorName",
      message: "입금자명을 입력해주세요",
      isMissing: isBlank(input.depositorName),
    },
    {
      field: "completionDate",
      message: "급행 마무리 날짜를 선택해주세요",
      isMissing: Boolean(input.isExpress) && isBlank(input.completionDate),
    },
  ]);
}

export function getGeneratedPostPersistenceIssues(input: {
  title?: string | null;
  content?: string | null;
  hashtags?: string | null;
  imageUrl?: string | null;
}) {
  return collectValidationIssues<GeneratedPostPersistenceField>([
    {
      field: "title",
      message: "게시물 제목을 다시 확인해주세요",
      isMissing: isBlank(input.title),
    },
    {
      field: "content",
      message: "게시물 내용을 다시 확인해주세요",
      isMissing: isBlank(input.content),
    },
    {
      field: "hashtags",
      message: "해시태그를 다시 확인해주세요",
      isMissing: isBlank(input.hashtags),
    },
    {
      field: "imageUrl",
      message: "생성된 이미지를 다시 확인해주세요",
      isMissing: isBlank(input.imageUrl),
    },
  ]);
}
