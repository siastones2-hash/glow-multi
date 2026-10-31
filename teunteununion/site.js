(() => {
  const reveal = () => document.body.classList.add("show-home");
  const curtain = document.getElementById("introCurtain");
  if (!curtain) { reveal(); return; }
  const params = new URLSearchParams(location.search);
  const forceIntro = params.has("intro");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const seen = sessionStorage.getItem("teunteun_intro");
  if (forceIntro) sessionStorage.removeItem("teunteun_intro");
  if (reduced || (!forceIntro && seen)) {
    curtain.remove();
    document.body.classList.remove("has-intro", "intro-lock");
    reveal();
    return;
  }
  document.body.classList.add("has-intro", "intro-lock");
  requestAnimationFrame(() => curtain.classList.add("intro-play"));
  window.setTimeout(() => {
    curtain.classList.add("exit");
    reveal();
  }, 2400);
  window.setTimeout(() => {
    curtain.classList.add("done");
    document.body.classList.remove("intro-lock");
    curtain.setAttribute("aria-hidden", "true");
    sessionStorage.setItem("teunteun_intro", "1");
    window.setTimeout(() => curtain.remove(), 900);
  }, 3400);
})();

const header = document.querySelector(".site-header");
const nav = document.querySelector("[data-nav]");
const menuBtn = document.querySelector(".menu-btn");

if (menuBtn && nav) {
  menuBtn.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
  });
  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      nav.classList.remove("open");
      menuBtn.setAttribute("aria-expanded", "false");
    });
  });
}

addEventListener("scroll", () => {
  if (header) header.classList.toggle("scrolled", scrollY > 8);
}, { passive: true });

const file = (location.pathname.split("/").pop() || "index.html").split("?")[0] || "index.html";
const current = {
  "pain.html": "departments.html",
  "obesity.html": "departments.html",
  "more.html": "departments.html",
  "physio.html": "departments.html",
  "skin.html": "departments.html",
  "internal.html": "departments.html",
  "departments.html": "departments.html",
  "greeting.html": "greeting.html",
  "doctor.html": "greeting.html"
}[file] || file;
document.querySelectorAll("[data-nav] a").forEach((link) => {
  const href = link.getAttribute("href");
  if (href === file || href === current) link.classList.add("on");
});

const schedule = {
  0: null,
  1: ["08:30", "18:30"],
  2: ["08:30", "18:30"],
  3: ["08:30", "13:00"],
  4: ["08:30", "20:00"],
  5: ["08:30", "18:30"],
  6: ["08:30", "13:00"]
};
const names = ["일", "월", "화", "수", "목", "금", "토"];
const now = new Date();
const day = now.getDay();
const rowDay = day === 2 || day === 5 ? 1 : day;
document.querySelectorAll("[data-day]").forEach((row) => {
  if (Number(row.dataset.day) === rowDay) row.classList.add("is-today");
});

const todayEl = document.getElementById("today");
if (todayEl) {
  const hours = schedule[day];
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMin = (hm) => {
    const [h, m] = hm.split(":").map(Number);
    return h * 60 + m;
  };
  let text = "일요일 휴무";
  if (hours) {
    const [open, close] = hours;
    const half = close === "13:00";
    const range = names[day] + " " + open + "–" + close + (day === 4 ? " 야간" : "");
    if (mins < toMin(open)) text = range + " · 시작 전";
    else if (mins < 12 * 60) text = range + " · 오전 접수";
    else if (half || mins >= toMin(close)) text = range + " · 접수 마감";
    else if (mins < 13 * 60 + 30) text = range + " · 오후 1:30부터";
    else text = range + " · 오후 진료";
  }
  todayEl.textContent = text;
}

(() => {
  const slides = [...document.querySelectorAll(".home-hero .hero-slide")];
  const dots = [...document.querySelectorAll(".home-hero .hero-dots button")];
  if (slides.length < 2) return;
  let index = 0;
  let timer = 0;
  const show = (n) => {
    index = (n + slides.length) % slides.length;
    slides.forEach((slide, i) => slide.classList.toggle("is-on", i === index));
    dots.forEach((dot, i) => {
      const on = i === index;
      dot.classList.toggle("is-on", on);
      dot.setAttribute("aria-selected", on ? "true" : "false");
    });
  };
  const arm = () => {
    clearInterval(timer);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    timer = setInterval(() => show(index + 1), 7000);
  };
  dots.forEach((dot, i) => dot.addEventListener("click", () => {
    show(i);
    arm();
  }));
  arm();
})();

(() => {
  const hero = document.querySelector(".home-hero");
  const stage = document.querySelector(".hero-stage");
  if (!hero || !stage) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let lookX = 0;
  let lookY = 0;
  let turnX = 0;
  let turnY = 0;
  let frame = 0;
  const draw = (now) => {
    const t = now / 1000;
    const driftX = Math.sin(t * 0.22) * 3.4;
    const driftY = Math.cos(t * 0.17) * 1.8;
    turnX += (driftX + lookX - turnX) * 0.045;
    turnY += (driftY + lookY - turnY) * 0.045;
    stage.style.transform = "rotateX(" + (-turnY).toFixed(2) + "deg) rotateY(" + turnX.toFixed(2) + "deg) scale(1.14)";
    frame = requestAnimationFrame(draw);
  };
  hero.addEventListener("pointermove", (event) => {
    const box = hero.getBoundingClientRect();
    lookX = ((event.clientX - box.left) / box.width - 0.5) * 5;
    lookY = ((event.clientY - box.top) / box.height - 0.5) * 3.2;
  });
  hero.addEventListener("pointerleave", () => {
    lookX = 0;
    lookY = 0;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(frame);
    else frame = requestAnimationFrame(draw);
  });
  frame = requestAnimationFrame(draw);
})();

(() => {
  const layer = document.createElement("div");
  layer.className = "consult";
  layer.hidden = true;
  layer.innerHTML = [
    '<div class="consult-card" role="dialog" aria-modal="true" aria-labelledby="consultTitle">',
    '<button class="consult-close" type="button">닫기</button>',
    '<p class="consult-kicker">튼튼연합의원</p>',
    '<h2 id="consultTitle">상담신청</h2>',
    '<p class="consult-phone"><a href="tel:041-588-5575">041-588-5575</a></p>',
    '<p>통증, 비만, 물리·도수, 피부, 내과.</p>',
    '<p>진료 시작 08:30. 오후 진료 13:30. 목요일 야간 20:00.</p>',
    '<a class="consult-call" href="tel:041-588-5575">전화하기</a>',
    '</div>'
  ].join("");
  const rail = document.createElement("aside");
  rail.className = "consult-rail";
  rail.setAttribute("aria-label", "상담");
  rail.innerHTML = '<button type="button" data-consult>상담신청</button><a href="tel:041-588-5575">전화</a>';
  document.body.append(rail, layer);

  const open = () => {
    if (nav) nav.classList.remove("open");
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
    layer.hidden = false;
    layer.querySelector(".consult-close").focus();
    if (window.ttEvent) window.ttEvent("consult_open", { page: location.pathname });
  };
  const close = () => { layer.hidden = true; };
  document.querySelectorAll("[data-consult]").forEach((button) => {
    button.addEventListener("click", open);
  });
  layer.querySelector(".consult-close").addEventListener("click", close);
  layer.addEventListener("click", (event) => {
    if (event.target === layer) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !layer.hidden) close();
  });
})();

document.addEventListener("click", (event) => {
  const link = event.target.closest("a");
  if (!link || !window.ttEvent) return;
  const href = link.getAttribute("href") || "";
  if (href.indexOf("tel:") === 0) window.ttEvent("phone_click", { page: location.pathname });
  else if (href.indexOf("place.naver.com") !== -1) window.ttEvent("naver_click", { page: location.pathname });
});
