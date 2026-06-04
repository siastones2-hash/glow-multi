/* ===== LAURELLAI v3 Site Common Script ===== */
const STORAGE_KEY = 'laurellai_cms_v3';

const DEFAULT_CONTENT = {
  brand: {
    name: 'Laurellai',
    footerDesc: '오리엔트골프가 선보이는 프리미엄 파크골프 브랜드. 사각의 마법으로 파크골프 역사상 가장 높은 MOI를 실현합니다.',
    copyright: '© 2026 LAURELLAI · Orient Golf Co., Ltd.'
  },
  home: {
    heroTop: '사각의 마법',
    heroTagline: '',
    heroBottom: 'AT THE FIELD',
    heroName: 'Pink Stone',
    heroRole: '프리미엄 파크골프 드라이버',
    heroProduct: 'LAURELLAI',
    storyEyebrow: '',
    storyTitle: 'The Art of<br>Park Golf.',
    storyP1: '로렐라이는 파크골프 역사상 가장 높은 MOI를 실현한 브랜드입니다. 그 핵심은 단순하면서도 강력한 기하학적 우위 — 사각형 헤드.',
    storyP2: '네 귀퉁이까지 무게를 고르게 분배하는 정교한 사각 설계와 후방에 정밀하게 배치된 3개의 고밀도 웨이트가, 미스 히트에서도 흔들리지 않는 절대적인 안정감을 완성합니다.',
    lineupEyebrow: 'Collection',
    lineupTitle: 'Two Stones,<br>One Standard.',
    lineupDesc: '같은 사각의 마법, 다른 감성. 핑크의 우아함과 블랑의 정숙함이 만드는 두 가지 정점.',
    techEyebrow: 'Technology',
    techTitle: '극한의 MOI',
    techDesc: '사각 헤드 + 후방 3웨이트 시스템. 특허 출원 중인 Square Rear Weighted Technology가 만드는<br>차원이 다른 안정감.',
    stat1Num: 'MAX', stat1Label: 'Park Golf MOI',
    stat2Num: '3', stat2Label: 'Rear Weights',
    stat3Num: '2', stat3Label: 'Signature Lines',
    stat4Num: 'PAT.', stat4Label: 'Patent Pending',
    accEyebrow: '',
    accTitle: 'ACCESSORIES',
    accSubtitle: '',
    accDesc: 'Laurellai Park Golf의 악세사리는 샤넬과 에르메스를 연상시키는 진정한 럭셔리 아이템입니다. 부드럽고 고귀한 터치, 세밀한 스티칭, 그리고 시간이 지날수록 깊어지는 매력으로 오랜 세월 함께할 파트너임을 증명합니다.',
    eventLogo: 'LRL',
    eventTitle: '신제품 사전 등록 이벤트',
    eventPeriod: '이벤트 기간: 2026.05.20 (화) ~ 2026.06.30 (월)',
    eventCta: '이벤트 자세히 보기',
    dealerEyebrow: 'Dealers',
    dealerTitle: 'Find Your<br>Store.',
    dealerDesc: '전국 공식 대리점에서 로렐라이의 완성도를 직접 확인하세요. 신규 파트너 신청도 함께 받고 있습니다.',
    dealerBenefits: [
      '본사 직영 영업 지원 및 마케팅 자료 제공',
      '지역 독점권 및 마진 보장 정책',
      '신제품 우선 공급 및 교육 프로그램',
      '3D 매장 투어 제작 지원 (선택)'
    ],
    journalEyebrow: 'Journal',
    journalTitle: 'News &<br>Stories.',
    journalDesc: '로렐라이의 최근 소식과 브랜드 스토리.',
    journal1Date: 'May 2026',
    journal1Title: 'Pink Stone — 사각의 마법이 깨어나다',
    journal1Excerpt: '로렐라이의 첫 시그니처 모델이 정식 출시되었습니다. 보석 커팅 헤드의 비밀.',
    journal2Date: 'April 2026',
    journal2Title: 'Square Rear Weighted Technology',
    journal2Excerpt: '특허 출원 중인 사각 헤드 + 후방 3웨이트 기술의 모든 것.',
    journal3Date: 'March 2026',
    journal3Title: '파크골프 시장의 변화',
    journal3Excerpt: '한국 파크골프 인구가 100만을 넘어선 지금, 프리미엄 브랜드가 필요한 이유.'
  },
  products: {
    items: {
      pink: {
        name: 'Pink Stone', meta: 'Pink Edition',
        short: '사각의 마법이 깨어나는 순간. 보석 커팅 헤드와 후방 3웨이트가 만드는 파크골프 역사상 최고 수준의 MOI. Ebony 그립과 로즈골드 메탈이 완성하는 여성 골퍼를 위한 럭셔리 마스터피스.',
        long: 'Laurellai Park Golf의 Pink Stone은 파크골프 역사상 가장 높은 MOI를 실현한 혁신적인 사각 헤드 디자인으로, 안정감 넘치는 샷을 선사합니다.\n\n후방에 정교하게 배치된 3개의 웨이트가 극한의 관성 모멘트를 만들어, 미스 히트에서도 헤드가 흔들림 없이 목표를 향해 나아갑니다.\n\n헤드 크라운은 보석 커팅 기법을 그대로 구현한 독창적인 패턴으로 빛을 받을 때마다 고급스러운 광채를 발산하며, 다른 어떤 클럽과도 차별화된 존재감을 드러냅니다.\n\n초경량 티타늄 솔을 채용하여 낮은 무게중심과 최고의 방향성을 실현했으며, 로즈골드 톤의 메탈 그립캡과 호젤, 깊고 고귀한 Ebony(흑단) 소재로 제작된 헤드와 프리미엄 스웨이드 그립이 완벽한 조화를 이룹니다.\n\nPink Stone은 단순한 클럽이 아닙니다. 티타늄 솔의 경량성과 사각의 마법이 어우러진, 그린 위에서 펼쳐지는 예술이자 최고급 럭셔리 아이템입니다.',
        spec1Label: 'Head Shape', spec1Value: 'Square / Jewel Cut',
        spec2Label: 'Sole', spec2Value: 'Ultralight Titanium',
        spec3Label: 'Grip Material', spec3Value: 'Ebony (흑단)',
        spec4Label: 'Metal Tone', spec4Value: 'Rose Gold'
      },
      blanc: {
        name: 'Blanc Stone', meta: 'Blanc Edition',
        short: '순백의 우아함 속에 담긴 절대적인 안정성. 사각 헤드와 후방 3웨이트 시스템이 만드는 정숙한 지배자. Maple 그립과 옐로우골드 메탈이 완성하는 시대를 초월한 마스터피스.',
        long: 'Blanc Stone은 Laurellai Park Golf의 플래그십 모델로, 사각 헤드의 기하학적 완벽함과 후방 3웨이트 시스템이 파크골프 사상 최고 수준의 MOI를 달성합니다.\n\n어떠한 임팩트에서도 헤드가 흔들리지 않고, 일관적인 방향성을 실현하는 사각의 마법을 경험하세요.\n\n보석처럼 세밀하게 커팅된 헤드 크라운은 빛과 각도에 따라 섬세한 광택을 발하며, 초경량 티타늄 솔이 낮은 무게중심과 뛰어난 컨택을 제공합니다.\n\n고급스러운 화이트 톤과 옐로우골드 메탈 그립캡·호젤, 그리고 고급 Maple(단풍나무) 소재로 제작된 헤드, 스웨이드 소재의 그립은 자연스러운 따뜻함을 담았고, 자연스러운 따뜻한 질감으로 손에 착 감기는 최고의 그립감을 선사하며 Blanc Stone의 순백의 우아함을 더욱 빛나게 합니다.\n\nBlanc Stone은 그린 위의 정숙한 지배자입니다. 티타늄 솔의 정밀한 기술력과 절제된 럭셔리를 동시에 추구하는 골퍼를 위한 시대를 초월한 마스터피스입니다.',
        spec1Label: 'Head Shape', spec1Value: 'Square / Jewel Cut',
        spec2Label: 'Sole', spec2Value: 'Ultralight Titanium',
        spec3Label: 'Grip Material', spec3Value: 'Maple (단풍나무)',
        spec4Label: 'Metal Tone', spec4Value: 'Yellow Gold'
      }
    }
  },
  technology: {
    pageSubtitle: '사각의 마법, 극한의 MOI',
    f1Title: '사각의 마법',
    f1Desc: '일반적인 삼각형 헤드는 무게 중심이 앞쪽으로 치우쳐 미스 히트 시 토크가 크게 발생합니다. 로렐라이의 정교한 사각형 헤드는 네 귀퉁이까지 무게를 고르게 분배할 수 있는 구조적 설계를 바탕으로, 본질적으로 관성 모멘트가 월등히 높습니다.',
    f1Num1: 'MAX', f1Label1: 'MOI',
    f1Num2: '', f1Label2: '',
    f2Title: '극한의 MOI',
    f2Desc: '헤드 후방에 정밀하게 삽입된 3개의 고밀도 웨이트가 무게 중심(CG)을 극도로 후방으로 이동시켜, 관성 모멘트를 한 차원 더 끌어올립니다. 오프센터 히트에서도 놀라운 직진성과 안정성.',
    f2Num1: '3', f2Label1: 'PRECISION WEIGHTS',
    f2Num2: '', f2Label2: '',
    f3Title: '특허 출원중',
    f3Desc: '스퀘어 웨이트 테크놀러지는 현재 특허 출원 중이며, Laurellai Park Golf만이 독점적으로 사용할 수 있는 기술입니다. 다른 어떤 브랜드도 따라올 수 없는, 혁신의 기술입니다.',
    f3Num1: '오직 로렐라이만', f3Label1: 'LAURELLAI ONLY',
    f3Num2: '', f3Label2: '',
    closingTitle: '럭셔리 클럽의<br>새로운 기준.',
    closingDesc: 'Pink Stone과 Blanc Stone에 적용된 이 기술은 단순한 성능 향상이 아닙니다. 그린 위에서 골퍼에게 절대적인 자신감과 고요한 지배력을 선사하는, 럭셔리 클럽의 새로운 기준입니다.'
  },
  accessories: {
    items: {
      'bag-stand': {
        name: 'Single Club Bag', meta: 'Off-White / Black',
        short: '',
        long: '미니멀하면서도 세련된 싱글형 디자인. 라이트 오프화이트와 딥 블랙 두 가지 컬러로 제공되며, 컴팩트한 사이즈에 프리미엄 가죽의 무게감과 고급스러운 형태미를 모두 담았습니다. 코스로 향하는 길에서도, 클럽을 보호하는 순간에도 품격을 지켜줍니다.'
      },
      'bag-small': {
        name: 'Backpack Club Bag', meta: 'Off-White / Black',
        short: '백팩형으로 재해석한 모델. 어깨에 메는 순간 편안함과 럭셔리한 존재감.',
        long: '백팩형으로 재해석한 모델. 오프화이트와 블랙 컬러로 만나볼 수 있으며, 어깨에 메는 순간 편안함과 함께 럭셔리한 존재감을 선사합니다.\n\n넉넉한 수납공간과 완벽한 밸런스로 라운드 내내 자유로운 움직임을 돕습니다. 부드럽고 고귀한 터치, 세밀한 스티칭, 시간이 지날수록 깊어지는 매력으로 오랜 세월 함께할 파트너임을 증명합니다.'
      },
      'pouch': {
        name: 'Hip Pouch', meta: 'Off-White / Black',
        short: '허리에 착 감기는 럭셔리 디테일. 메탈 버클이 포인트인 하이 주얼리 같은 파우치.',
        long: '허리에 착 감기는 Laurellai Park Golf Hip Pouch는 섬세한 곡선과 아름다운 메탈 버클이 포인트로, 마치 하이 주얼리처럼 빛나는 디테일이 돋보입니다.\n\n볼 몇 개와 작은 필수품을 여유롭게 수납하면서도 실루엣을 해치지 않는 슬림한 디자인. 오프화이트와 블랙 두 가지 컬러로 구성되어 Pink Stone, Blanc Stone과 함께 매치하기에 완벽합니다.\n\n그린 위를 걸을 때마다 느껴지는 고급스러운 무게감과 부드러운 가죽의 터치가, 당신의 스타일을 한층 더 우아하게 완성합니다.'
      },
      'ball': {
        name: 'Golf Ball', meta: '3 Signature Colors',
        short: '3피스 프리미엄 퍼포먼스 볼. 정밀 3중 얼라인먼트 라인.\nTiffany Blue · Hermès Orange · Pearl Pink.',
        long: 'Laurellai Park Golf 3피스 볼은 뛰어난 탄성과 부드러운 그린 컨트롤을 자랑하는 프리미엄 퍼포먼스 볼입니다.\n\n가장 큰 차별점은 볼 중앙에 새겨진 정밀 3중 얼라인먼트 라인입니다. 헤드와 완벽하게 정렬할 수 있도록 설계되어, 매번 동일한 어드레스와 정확한 스트로크를 가능하게 합니다.\n\n3가지 시그니처 컬러:\n· Tiffany Blue — 청량하고 고귀한 블루\n· Hermès Orange — 따뜻하고 강렬한 오렌지\n· Pearl Pink — 부드럽고 우아한 펄 핑크\n\n각 볼은 Laurellai Park Golf의 사각 헤드와 조화롭게 디자인되어, 시각적 정렬은 물론 감성적인 만족감까지 동시에 선사합니다.'
      }
    }
  },
  dealers: {
    partnerTitle: 'Become an<br>Official Partner.',
    partnerDesc: '오리엔트골프는 로렐라이 브랜드의 전국 유통망을 함께 만들어갈 정식 대리점을 모집합니다. 파크골프 시장의 프리미엄 카테고리를 선점하실 분들을 기다립니다.',
    benefits: [
      '본사 직영 영업 지원 및 마케팅 자료 제공',
      '지역 독점권 및 마진 보장 정책',
      '신제품 우선 공급 및 교육 프로그램',
      '3D 매장 투어 제작 지원 (선택)'
    ]
  },
  journal: {
    article1Body: '로렐라이의 첫 시그니처 모델 Pink Stone이 정식 출시되었습니다.\n\n파크골프 역사상 가장 높은 MOI를 실현한 사각 헤드 디자인. 후방에 정교하게 배치된 3개의 웨이트가 극한의 관성 모멘트를 창출하여, 미스 히트에서도 헤드가 흔들림 없이 목표를 향해 나아갑니다.\n\n헤드 크라운은 보석 커팅 기법을 그대로 구현한 독창적인 패턴. 빛을 받을 때마다 고급스러운 광채를 발산하며, 다른 어떤 클럽과도 차별화된 존재감을 드러냅니다.\n\n초경량 티타늄 솔, 로즈골드 메탈 디테일, 그리고 깊고 고귀한 Ebony 그립이 완벽한 조화를 이룹니다. Pink Stone은 단순한 클럽이 아닙니다. 그린 위에서 펼쳐지는 예술이자, 최고급 럭셔리 아이템입니다.',
    article2Body: '로렐라이가 만든 가장 결정적인 차이는 헤드의 모양에 있습니다.\n\n일반적인 파크골프 클럽이 채택해온 삼각형 헤드는 무게 중심이 앞쪽으로 치우쳐 있어, 미스 히트 시 토크가 크게 발생하는 구조적 한계를 가집니다.\n\n로렐라이의 정교한 사각형 헤드는 네 귀퉁이까지 무게를 고르게 분배할 수 있는 구조적 설계를 바탕으로, 본질적으로 관성 모멘트가 월등히 높습니다.\n\n이 사각의 우위를 극대화하는 것이 헤드 후방에 정밀하게 삽입된 3개의 고밀도 웨이트입니다. 무게 중심(CG)을 극도로 후방으로 이동시켜, 관성 모멘트를 한 차원 더 끌어올립니다.\n\n결과적으로 파크골프 사상 최고 수준의 MOI를 달성. 오프센터 히트에서도 놀라운 직진성과 롤링 안정성을 제공합니다.\n\n이 혁신적인 Square Rear Weighted Technology는 현재 특허 출원 중이며, Laurellai Park Golf만이 독점적으로 사용할 수 있는 기술입니다.',
    article3Body: '한국 파크골프 인구가 100만 명을 넘어섰습니다.\n\n5년 전만 해도 시니어 동호인 중심의 작은 시장이었던 파크골프가, 이제는 전 연령대로 빠르게 확산되고 있습니다. 전국 파크골프장 수는 500개를 넘어섰고, 매년 신규 인구가 가파르게 증가합니다.\n\n시장이 커지면 카테고리가 다양해집니다. 입문자용 보급형 클럽도 필요하지만, 진지하게 스포츠로 임하는 사용자들을 위한 프리미엄 클럽도 필요합니다.\n\n로렐라이는 후자를 위한 브랜드입니다. 골프 클럽 제조의 정통 기술을 파크골프에 그대로 옮겨와, "파크골프 클럽도 럭셔리 아이템이다"라는 명제를 실현합니다.\n\n시장의 변화는 기회입니다. 그리고 우리는, 그 기회의 한가운데에 있습니다.'
  },
  event: {
    intro: '로렐라이의 새로운 출발을 함께해주실 분들께 드리는 특별한 혜택. 가장 먼저 만나고, 가장 깊은 가치를 함께 나누세요.',
    benefits: [
      '사전 등록 시 정식 발매가 대비 15% 할인',
      '한정판 시리얼 넘버 각인 (1번~300번)',
      '전용 Hip Pouch + 시그니처 볼 3컬러 세트 증정',
      '전국 직영 매장 우선 시연 초청'
    ],
    howto: [
      '홈페이지 하단 뉴스레터 이메일 등록',
      '본인 인증 후 사전 예약 신청서 작성',
      '전국 정식 대리점 방문 또는 본사 직배송'
    ],
    notice: [
      '이벤트 기간 외 신청은 정상 판매가가 적용됩니다',
      '한정 수량 (300개) 소진 시 조기 마감될 수 있습니다',
      '각 1인당 1개 모델만 신청 가능합니다'
    ]
  },
  images: {}
};

function getContent() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return JSON.parse(JSON.stringify(DEFAULT_CONTENT));
    const parsed = JSON.parse(stored);
    return deepMerge(JSON.parse(JSON.stringify(DEFAULT_CONTENT)), parsed);
  } catch (e) { return JSON.parse(JSON.stringify(DEFAULT_CONTENT)); }
}

function saveContent(content) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(content)); return true; }
  catch (e) {
    alert('저장 실패: ' + e.message);
    return false;
  }
}

function deepMerge(target, source) {
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

function getByPath(obj, path) {
  return path.split('.').reduce((acc, key) => acc && acc[key], obj);
}

function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function applyContent() {
  const content = getContent();

  document.querySelectorAll('[data-cms]').forEach(el => {
    const path = el.getAttribute('data-cms');
    const value = getByPath(content, path);
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      el.innerHTML = value.map(v => `<li>${escapeHtml(v)}</li>`).join('');
    } else if (typeof value === 'string' && value.includes('<')) {
      el.innerHTML = value;
    } else {
      el.innerHTML = escapeHtml(value).replace(/\n/g, '<br>');
    }
  });

  document.querySelectorAll('.tech-spec-item').forEach(item => {
    const num = item.querySelector('.tech-spec-num');
    const label = item.querySelector('.tech-spec-label');
    const numText = num ? num.textContent.trim() : '';
    const labelText = label ? label.textContent.trim() : '';
    item.style.display = (!numText && !labelText) ? 'none' : '';
  });

  // 이미지: CMS 업로드 > data-default-src
  document.querySelectorAll('.img-slot[data-slot]').forEach(slot => {
    const slotId = slot.getAttribute('data-slot');
    const imgData = content.images && content.images[slotId];
    const defaultSrc = slot.getAttribute('data-default-src');
    const finalSrc = imgData || defaultSrc;
    if (finalSrc) {
      const existing = slot.querySelector('img.cms-img');
      if (existing) existing.remove();
      const img = document.createElement('img');
      img.src = finalSrc;
      img.className = 'cms-img';
      img.alt = slotId;
      slot.appendChild(img);
    }
  });
}

function initReveal() {
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          observer.unobserve(e.target);
        }
      });
    }, { threshold: 0.1 });
    reveals.forEach(r => observer.observe(r));
  } else {
    reveals.forEach(r => r.classList.add('visible'));
  }
}

function initSideMenu() {
  const toggle = document.getElementById('menuToggle');
  const close = document.getElementById('sideMenuClose');
  const menu = document.getElementById('sideMenu');
  const overlay = document.getElementById('sideMenuOverlay');
  if (!toggle || !menu || !overlay) return;

  function openMenu() {
    menu.classList.add('open');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeMenu() {
    menu.classList.remove('open');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }
  toggle.addEventListener('click', openMenu);
  if (close) close.addEventListener('click', closeMenu);
  overlay.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });
}

function initNoTranslate() {
  document.querySelectorAll(
    'header, .side-menu, .logo, .hero, .footer-brand, [data-cms]'
  ).forEach(el => el.setAttribute('translate', 'no'));
}

document.addEventListener('DOMContentLoaded', () => {
  applyContent();
  initNoTranslate();
  initReveal();
  initSideMenu();
});
