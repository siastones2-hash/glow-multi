/* 튼튼연합의원 측정. 계정 번호가 비어 있으면 스크립트를 넣지 않는다.
   gtm    Google Tag Manager  GTM-XXXX
   ga4    GA4 측정 ID          G-XXXX        (GTM을 쓰면 비워 둔다)
   pixel  메타 픽셀 ID
   google 구글 서치콘솔 소유 확인 코드
   naver  네이버 서치어드바이저 소유 확인 코드
*/
window.TT_IDS = window.TT_IDS || {
  gtm: "",
  ga4: "",
  pixel: "",
  google: "",
  naver: ""
};

window.dataLayer = window.dataLayer || [];
window.ttEvent = function (name, params) {
  window.dataLayer.push(Object.assign({ event: name }, params || {}));
  if (window.fbq) window.fbq("trackCustom", name, params || {});
};

(function () {
  var ids = window.TT_IDS;
  var head = document.head;
  if (!head) return;

  function meta(name, content) {
    if (!content) return;
    var tag = document.createElement("meta");
    tag.name = name;
    tag.content = content;
    head.appendChild(tag);
  }
  meta("google-site-verification", ids.google);
  meta("naver-site-verification", ids.naver);

  if (ids.gtm) {
    window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    var gtm = document.createElement("script");
    gtm.async = true;
    gtm.src = "https://www.googletagmanager.com/gtm.js?id=" + encodeURIComponent(ids.gtm);
    head.appendChild(gtm);
  } else if (ids.ga4) {
    var loader = document.createElement("script");
    loader.async = true;
    loader.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ids.ga4);
    head.appendChild(loader);
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", ids.ga4);
  }

  if (ids.pixel) {
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = "2.0";
      n.queue = [];
      t = b.createElement(e);
      t.async = true;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    window.fbq("init", ids.pixel);
    window.fbq("track", "PageView");
  }
})();
