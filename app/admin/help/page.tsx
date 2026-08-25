import { AdminNav } from "@/lib/ui/admin-nav";

// Plain-Korean admin manual. Static content (no data fetch, no secrets) so it
// loads instantly and is never orphaned — reachable from the shared nav on
// every admin page. Mirrors docs/admin-manual.md.

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      <h2 className="text-lg font-bold text-gray-900 border-b border-gray-100 pb-2">
        {title}
      </h2>
      <div className="space-y-3 text-sm text-gray-700 leading-relaxed">{children}</div>
    </section>
  );
}

function Step({ children }: { children: React.ReactNode }) {
  return <li className="ml-4 list-decimal">{children}</li>;
}

function Caution({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm text-amber-800">
      <span className="font-semibold">주의 </span>
      {children}
    </div>
  );
}

const TOC: Array<[string, string]> = [
  ["start", "시작하기"],
  ["dashboard", "대시보드"],
  ["users", "전체 유저"],
  ["outreach", "아웃리치"],
  ["marketer-urls", "잘못된 URL"],
  ["terms", "용어 설명"],
  ["mistakes", "자주 하는 실수 · 주의"],
];

export default function AdminHelpPage() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <AdminNav current="help" />

        <div>
          <h1 className="text-2xl font-bold text-gray-900">관리자 사용설명서</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            관리자 기능 사용법과 용어를 설명합니다. 처음이신 분은 위에서부터 읽어보세요.
          </p>
        </div>

        {/* Table of contents */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
            목차
          </p>
          <div className="flex flex-wrap gap-2">
            {TOC.map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                {label}
              </a>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-8">
          <Section id="start" title="시작하기">
            <ul className="space-y-1.5 list-disc ml-5">
              <li>상단 탭으로 이동합니다: 대시보드 · 전체 유저 · 아웃리치 · 잘못된 URL · 사용설명서.</li>
              <li>지금 보고 있는 페이지는 상단 탭에서 진하게 표시됩니다.</li>
              <li>관리자 계정으로 로그인해야 열립니다. 권한이 없으면 “접근 권한이 없습니다”가 보입니다.</li>
              <li>각 페이지의 <b>새로고침</b> 버튼으로 최신 데이터를 다시 불러옵니다.</li>
            </ul>
          </Section>

          <Section id="dashboard" title="대시보드">
            <p>운영 지표, 문의, 사전등록을 한 곳에서 관리하는 시작 화면입니다.</p>
            <p className="font-semibold text-gray-900">운영 현황</p>
            <p>오늘/이번 주 활성 사용자, 가입 수, AI 생성 수, 구독, 무료체험 현황을 봅니다. 숫자는 조회 시점 기준이라 최신 값은 새로고침을 누르세요.</p>
            <p className="font-semibold text-gray-900">문의 관리</p>
            <ol className="space-y-1">
              <Step>답변할 문의를 찾습니다 (기본은 미답변만 보기).</Step>
              <Step>답변 입력란에 내용을 적고 <b>답변</b>을 누릅니다.</Step>
              <Step>답변은 사용자의 문의 위젯에 표시되고, 안 읽음 표시가 다시 뜹니다.</Step>
            </ol>
            <p className="font-semibold text-gray-900">사전등록 (일괄/개별 등록 · 등록 현황)</p>
            <p>회원가입 전에 사용자에게 미리 권한을 부여합니다. 이렇게 등록된 사람은 가입 전까지 “미가입”으로 보입니다.</p>
            <ul className="space-y-1 list-disc ml-5">
              <li><b>일괄 등록:</b> 엑셀/구글시트에서 행을 복사해 붙여넣고 미리보기 → 확정. 첫 줄(헤더)에 이메일 열이 반드시 있어야 합니다.</li>
              <li><b>개별 등록:</b> 한 명씩 폼으로 추가.</li>
              <li><b>등록 현황:</b> 목록 검색·정렬, 항목 수정/삭제.</li>
            </ul>
            <Caution>같은 이메일을 다시 등록하면 기존 정보가 갱신됩니다. 이메일은 소문자로 관리됩니다.</Caution>
          </Section>

          <Section id="users" title="전체 유저">
            <p>가입·미가입 사용자를 검색하고, 상세 정보를 확인하고, 생성 횟수를 지급하는 페이지입니다.</p>
            <p className="font-semibold text-gray-900">검색 · 필터 · 내보내기</p>
            <ul className="space-y-1 list-disc ml-5">
              <li>이름·이메일·회사·기관으로 검색하고, 가입 여부·이용 유형·주관기관·구독 등으로 필터링합니다.</li>
              <li>열 제목을 클릭하면 정렬됩니다.</li>
              <li><b>엑셀 내보내기</b>는 현재 필터가 적용된 결과만 저장합니다.</li>
            </ul>
            <p className="font-semibold text-gray-900">상세 보기 (행 클릭)</p>
            <p>기본 정보, 최초 접속일/접속 횟수, 구독·잔여 생성 횟수, AI 생성물, 생성 로그, 마케터 제출 내역, 생성 횟수 지급 이력을 탭으로 봅니다. 마케터 제출 정보는 여기서 직접 수정할 수 있습니다.</p>
            <p className="font-semibold text-gray-900">생성 횟수 지급</p>
            <ol className="space-y-1">
              <Step>상세 → <b>생성 횟수 지급</b> 탭으로 이동합니다.</Step>
              <Step>수량, 사유(관리자용), 사용자에게 보여줄 메시지를 입력합니다.</Step>
              <Step><b>지급하기</b>를 누르면 즉시 반영됩니다.</Step>
            </ol>
            <Caution>
              지급은 <b>즉시 잔여 생성 횟수에 더해지며 되돌릴 수 없습니다.</b> 수량을 꼭 확인하세요.
              활성 구독이 없으면 1개월 구독이 새로 만들어집니다. 사용자는 다음 접속 때 축하 팝업을 한 번 봅니다.
            </Caution>
          </Section>

          <Section id="outreach" title="아웃리치">
            <p>아직 가입하지 않은(미가입)·사전등록 사용자에게 안내/광고 메시지를 보내는 페이지입니다.</p>
            <ul className="space-y-1 list-disc ml-5">
              <li>상단에 이메일/SMS/알림톡의 <b>설정됨 / 미설정</b>이 표시됩니다. 미설정 채널은 발송할 수 없습니다.</li>
              <li>검색·필터로 대상을 좁히고, <b>필터 전체 선택</b> 또는 개별 체크로 수신자를 정합니다.</li>
              <li><b>수신거부</b>한 사람은 회색으로 표시되고 자동 제외됩니다.</li>
              <li><b>개인화 변수</b> <code>{"{{name}}"}</code>, <code>{"{{company}}"}</code> 로 사람마다 이름/회사를 넣을 수 있습니다.</li>
            </ul>
            <p className="font-semibold text-gray-900">발송 순서</p>
            <ol className="space-y-1">
              <Step><b>테스트 발송</b>으로 내 주소에 먼저 보내 실제 모습을 확인합니다 (기록 안 남음).</Step>
              <Step><b>발송</b>을 누르면 대상 수·채널·예상 비용 <b>확인 창</b>이 뜹니다.</Step>
              <Step>내용을 확인하고 <b>정말 발송하기</b>를 누릅니다. 200명 이상이면 경고가 표시됩니다.</Step>
            </ol>
            <p className="font-semibold text-gray-900">발송 이력</p>
            <p>캠페인별 대상/성공/실패/건너뜀을 보고, 행을 클릭하면 수신자별 결과가 열립니다. <b>실패분 재발송</b>과 <b>이 내용으로 다시 작성</b>(복제)을 쓸 수 있습니다.</p>
            <Caution>
              상품·서비스 홍보는 반드시 <b>광고성</b>으로 보내세요. 광고성은 <b>(광고) 표기</b>와{" "}
              <b>무료수신거부</b>가 자동으로 붙습니다(표시광고법). 알림톡은 정보성 전용이라 미가입 광고에는
              부적합하니, 미가입 홍보는 SMS(광고)를 권장합니다.
            </Caution>
          </Section>

          <Section id="marketer-urls" title="잘못된 URL">
            <p>마케터 제출 내역 중 형식이 잘못된 URL만 모아 보여주는 점검 페이지입니다.</p>
            <p>각 행은 제출자, 어떤 필드의 URL인지, 입력값, 문제 사유를 보여줍니다. 이를 보고 사용자에게 수정을 안내하면 됩니다. 문제가 없으면 “형식 오류 URL이 없습니다 🎉”가 표시됩니다.</p>
          </Section>

          <Section id="terms" title="용어 설명">
            <dl className="space-y-2">
              {[
                ["미가입", "아직 회원가입하지 않은 사전등록 사용자. 이메일/전화만 있고 로그인 기록이 없습니다."],
                ["사전등록", "회원가입 전에 관리자가 미리 권한을 부여해 두는 것."],
                ["주관기관", "사용자를 사전등록해 준 기관(host_org)."],
                ["생성 횟수", "AI 생성기로 게시물을 만들 수 있는 남은 횟수. 요금제 페이지의 크레딧(1원=1크레딧 충전 단위)과는 다른 개념입니다."],
                ["안내성 / 광고성", "안내성=단순 공지. 광고성=상품·서비스 홍보. 광고성은 (광고) 표기와 무료수신거부가 자동 추가됩니다."],
                ["수신거부", "메시지 수신을 거부한 상태. 이후 발송에서 자동으로 제외됩니다."],
                ["무료 유저 / 구독", "결제·권한 상태 구분. 무료 유저는 결제 이력이 없는 사용자."],
              ].map(([term, desc]) => (
                <div key={term} className="flex gap-3">
                  <dt className="font-semibold text-gray-900 shrink-0 w-28">{term}</dt>
                  <dd className="text-gray-600">{desc}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section id="mistakes" title="자주 하는 실수 · 주의">
            <ul className="space-y-1.5 list-disc ml-5">
              <li><b>생성 횟수 지급은 되돌릴 수 없습니다.</b> 횟수를 다시 확인하세요.</li>
              <li><b>광고 메시지는 반드시 “광고성”으로.</b> 안내성으로 홍보를 보내면 법 위반 소지가 있습니다.</li>
              <li><b>대량 발송 전 테스트 발송</b>으로 실제 모습을 먼저 확인하세요.</li>
              <li><b>엑셀 내보내기는 현재 필터 결과만</b> 저장합니다. 전체를 원하면 필터를 초기화하세요.</li>
              <li>숫자가 이상하면 대부분 <b>새로고침</b>으로 해결됩니다 (조회 시점 데이터).</li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
