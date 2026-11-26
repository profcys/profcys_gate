/**
 * 적용 예시 — 기존 업무 Apps Script 의 Code.gs 에 다음 형태로 반영한다.
 * (기존 doGet 의 화면 생성 코드는 render 함수 안으로 옮기고, 데이터·시트 로직은 수정하지 않는다)
 */

// 1) 기존 doGet 을 아래처럼 감싼다.
function doGet(e) {
  return ProfcysAuth.handle(e, render_);
}

// 2) 포털은 인증 코드를 POST 로 전달하므로 doPost 도 처리한다.
//    기존에 doPost 가 있었다면 legacyDoPost_ 로 이름을 바꾸고 세 번째 인자로 넘긴다.
function doPost(e) {
  return ProfcysAuth.handle(e, render_ /*, legacyDoPost_ */);
}

// 3) 기존 화면 생성 코드
function render_(e, auth) {
  var t = HtmlService.createTemplateFromFile('Index');
  t.profcysToken = auth ? auth.token : '';
  t.userName = auth ? auth.user.displayName : '';
  return t.evaluate()
    .setTitle('업무 서비스')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// 4) google.script.run 으로 호출되는 서버 함수는 첫 번째 인자로 토큰을 받고, 첫 줄에서 확인한다.
function getMyData(token) {
  var user = ProfcysAuth.require(token); // 권한 회수·계정 비활성·로그아웃 시 예외
  // user: { uid, username, displayName, role, organization, department, position, email } — monitor 모드에서 직접 접근 시 null
  return { hello: user ? user.displayName : '(포털 미경유 접속)' };
}

function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }
