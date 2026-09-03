(function (global) {
  function normalize(text) {
    return String(text || "").replace(/[\s\t\n\r]/g, "");
  }

  var RULES = [
    ["사업자등록증", [["사업자등록증", 120], ["사업자 등록증", 120], ["사업자등록번호", 90], ["고유번호증", 110], ["과세유형", 40], ["개업연월일", 50]]],
    ["법인등기부등본", [["등기사항전부증명서", 130], ["법인등기", 140], ["발행주식", 80]]],
    ["부동산등기부등본", [["부동산등기", 140], ["기사항전부증명", 90], ["사항전부증명서", 90], ["말소사항", 70], ["집합건물", 80]]],
    ["초본", [["주민등록표 초본", 140], ["주민등록표초본", 140], ["초본", 80]]],
    ["등본", [["주민등록표 등본", 140], ["주민등록표등본", 140], ["등본", 70], ["세대별 주민등록", 90], ["세대주", 35], ["세대원", 35]]],
    ["가족관계증명서", [["가족관계증명서", 140], ["가족관계 증명", 120]]],
    ["기본증명서", [["기본증명서", 140]]],
    ["혼인관계증명서", [["혼인관계증명서", 140]]],
    ["인감증명서", [["인감증명서", 140]]],
    ["본인서명사실확인서", [["본인서명사실확인서", 140]]],
    ["주민등록증", [["주민등록증", 130]]],
    ["운전면허증", [["운전면허증", 140], ["자동차운전면허", 130]]],
    ["여권", [["PASSPORT", 100], ["대한민국 여권", 140], ["여권번호", 90]]],
    ["외국인등록증", [["외국인등록증", 140]]],
    ["통장사본", [["통장사본", 140], ["통장 사본", 140], ["계좌번호", 50], ["예금주", 45]]],
    ["자동차등록증", [["자동차등록증", 140], ["차대번호", 80]]],
    ["건강보험자격득실확인서", [["자격득실확인서", 140], ["건강보험", 40]]],
    ["소득금액증명", [["소득금액증명", 140], ["소득금액", 110]]],
    ["납세증명서", [["납세증명서", 140], ["납세증명", 100]]],
    ["지방세납세증명", [["지방세납세증명", 160], ["지방세 납세증명", 160]]],
    ["지방세세목별과세증명", [["세목별과세", 160], ["세목별", 110], ["과세증명", 90]]],
    ["견적서", [["견적서", 140], ["견적금액", 90]]],
    ["리스신청서", [["리스신청", 150], ["리스 신청", 150], ["금융리스", 80]]],
    ["매출자료", [["매출자료", 140], ["카드매출", 120], ["매출현황", 120], ["이용시간", 90], ["상품판매", 90], ["받을금액", 80], ["매출", 50]]],
    ["재직증명서", [["재직증명서", 140]]],
    ["임대차계약서", [["임대차계약", 140], ["부동산임대차", 120], ["임차인", 50], ["임대인", 50]]],
    ["위임장", [["위임장", 130]]]
  ];

  function classify(text) {
    var raw = String(text || "");
    var compact = normalize(raw);

    if (compact.indexOf("세대별주민등록") !== -1) return finish("등본", 300, compact);
    if (compact.indexOf("주민등록표") !== -1 && compact.indexOf("초본") !== -1) return finish("초본", 300, compact);
    if (compact.indexOf("주민등록표") !== -1 && compact.indexOf("등본") !== -1) return finish("등본", 300, compact);
    if (compact.indexOf("소득금액") !== -1 && compact.indexOf("증명") !== -1) return finish("소득금액증명", 300, compact);
    if (compact.indexOf("지방세") !== -1 && compact.indexOf("납세증명") !== -1) return finish("지방세납세증명", 300, compact);
    if (compact.indexOf("세목별") !== -1 || (compact.indexOf("지방세") !== -1 && compact.indexOf("과세증명") !== -1)) {
      return finish("지방세세목별과세증명", 300, compact);
    }
    if (
      compact.indexOf("집합건물") !== -1 ||
      compact.indexOf("말소사항포함") !== -1 ||
      (compact.indexOf("전부증명") !== -1 && (compact.indexOf("토지") !== -1 || compact.indexOf("건물") !== -1))
    ) {
      return finish("부동산등기부등본", 300, compact);
    }
    if (compact.indexOf("자격득실") !== -1) return finish("건강보험자격득실확인서", 300, compact);
    if (
      compact.indexOf("이용시간") !== -1 ||
      compact.indexOf("상품판매") !== -1 ||
      compact.indexOf("받을금액") !== -1 ||
      compact.indexOf("PC이용") !== -1
    ) {
      return finish("매출자료", 300, compact);
    }

    var best = "기타";
    var bestScore = 0;
    RULES.forEach(function (rule) {
      var folder = rule[0];
      var score = 0;
      rule[1].forEach(function (item) {
        var needle = item[0];
        if (raw.indexOf(needle) !== -1 || compact.indexOf(normalize(needle)) !== -1) score += item[1];
      });
      if (folder === "등본" && (compact.indexOf("법인등기") !== -1 || compact.indexOf("부동산등기") !== -1)) score = 0;
      if (folder === "납세증명서" && (compact.indexOf("지방세") !== -1 || compact.indexOf("세목별") !== -1)) score = 0;
      if (folder === "법인등기부등본" && (compact.indexOf("집합건물") !== -1 || compact.indexOf("토지") !== -1)) score = 0;
      if (folder === "주민등록증" && (compact.indexOf("주민등록표") !== -1 || compact.indexOf("초본") !== -1)) score = 0;
      if (folder === "가족관계증명서" && (compact.indexOf("주민등록표") !== -1 || compact.indexOf("세대별주민등록") !== -1)) score = 0;
      if (folder === "사업자등록증" && compact.indexOf("소득금액") !== -1) score = 0;
      if (score > bestScore) {
        bestScore = score;
        best = folder;
      }
    });
    if (bestScore < 40) return finish("기타", bestScore, compact);
    return finish(best, bestScore, compact);
  }

  function titleFor(folder, compact) {
    if (folder === "부동산등기부등본") {
      if (compact.indexOf("집합건물") !== -1) return "부동산등기부등본_집합건물";
      if (compact.indexOf("토지") !== -1 && compact.indexOf("건물") === -1) return "부동산등기부등본_토지";
      if (compact.indexOf("건물") !== -1) return "부동산등기부등본_건물";
    }
    return folder;
  }

  function finish(folder, score, compact) {
    return { folder: folder, score: score, title: titleFor(folder, compact || "") };
  }

  global.DocClassify = { classify: classify, normalize: normalize, titleFor: titleFor };
})(window);
