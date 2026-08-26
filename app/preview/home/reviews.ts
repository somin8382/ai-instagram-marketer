export type Review = {
  /** Primary attribution line. Company where there is one, person otherwise. */
  name: string;
  /** Secondary attribution line. */
  role: string;
  /** Satisfaction out of 10. Absent where the customer did not give one. */
  score?: number;
  /**
   * Context lines shown in place of a missing score. First line is the shared
   * programme label, any further line is that customer's own credential.
   */
  notes?: string[];
  /**
   * Customer's own words, verbatim. Wrap the sentence that carries the point in
   * `**...**` to emphasise it; everything else renders at the softer body tone.
   */
  quote: string;
};

export const REVIEWS: Review[] = [
  {
    name: "쌤플",
    role: "박경미 대표",
    score: 10,
    quote:
      "인스타그램 운영과 홍보 방향을 잡는 데 어려움이 있었는데, AI 마케터를 활용하면서 **콘텐츠 기획이 훨씬 수월해졌습니다.** 실제로 **팔로워 증가와 게시물 홍보 효과에도 도움이 되었고,** 혼자 SNS를 운영할 때 유용하게 활용할 수 있었습니다. 초보자도 쉽게 사용할 수 있어서 좋았습니다. 앞으로 추천 콘텐츠나 홍보 아이디어가 조금 더 다양하게 제공되고, 업종별 맞춤 예시가 많아지면 실제 운영에 더욱 도움이 될 것 같습니다.",
  },
  {
    name: "매출쟁이",
    role: "츠지나츠미 대표",
    score: 10,
    quote:
      "**완전 좋아요!! 최고!! 진짜 좋음.** 일단 브랜딩이 되어야 하는데, 눈에 보이는 팔로워 수도 중요해서 AI 마케터가 참 좋아요.",
  },
  {
    name: "비번즈",
    role: "양선주 대표",
    score: 10,
    quote: "사용 후 **팔로워와 조회수가 증가했습니다.**",
  },
  {
    name: "다풀오",
    role: "김준호 대표",
    score: 9,
    quote: "사용 후 **인스타그램 유입량이 늘었어요.**",
  },
  {
    name: "메리노바",
    role: "황하정 대표",
    score: 7,
    quote:
      "**AI 생성기는 유용한 것 같아요.** 프롬프트를 상세하게 입력하면 원하는 콘텐츠를 만드는 데 활용할 수 있어요. 여기서 계정에 자동 업로드까지 되면 좋을 것 같아요. 날짜만 지정하고 주제와 콘텐츠 콘셉트만 정하면 콘텐츠 이미지가 자동으로 생성되고, 원하는 날짜와 시간에 캡션까지 함께 업로드되는 기능이 있으면 좋겠어요.",
  },
  {
    name: "본스탠다드",
    role: "안세영 대표",
    score: 7,
    quote: "서비스 이용 기간 동안 **팔로워가 증가했습니다.**",
  },
  {
    name: "캔히로직",
    role: "조상철 CTO",
    notes: ["모두의 창업 1기 이용고객", "CNTTech 1등 기업"],
    quote:
      "저희는 모두의 창업 CNTTech 1등 기업입니다. 처음에는 유튜브 구독자가 많지 않았지만, AI 마케터를 약 두 달간 활용하면서 **500명 이상의 구독자를 기록하는 등 실제 홍보 효과를 경험했습니다.** 다음 라운드에 진출하면 AI 마케터를 더욱 적극적으로 활용해 홍보를 강화하고, 사업 목표를 달성해 나가고 싶습니다. 지원 예산을 모두 AI 마케터에 투입하고 싶었지만, 규정상 한 번밖에 결제할 수 없다고 해서 **아쉬울 정도로 만족스럽게 활용했습니다.**",
  },
  {
    name: "김예나 대표",
    role: "예비창업자",
    notes: ["모두의 창업 1기 이용고객"],
    quote:
      "모두의 창업을 통해 AI 솔루션을 이용해보고, 이후에도 계속 활용할 수 있어서 너무 기뻐요! **별도 스튜디오에 외주를 맡기지 않고도 콘텐츠를 자체 제작할 수 있어** 활용도와 비용 측면에서도 만족스럽습니다. 증빙자료도 정말 꼼꼼하게 챙겨주셔서 마음이 든든했고, 저도 더 힘내서 콘텐츠를 제작할 수 있었습니다. 앞으로도 계속 잘 활용하고 싶어요.",
  },
];

/** Marker-free text, for measuring how much room a quote needs. */
export function quoteLength(quote: string) {
  return quote.replace(/\*\*/g, "").length;
}
