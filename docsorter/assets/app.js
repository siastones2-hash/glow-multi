(function () {
  var ACCESS_URL = "https://api.github.com/repos/siastones2-hash/glow-multi/contents/access.json?ref=docsorter-access";
  var gate = document.getElementById("gate");
  var workEls = [document.getElementById("drop"), document.getElementById("workRow"), document.getElementById("status"), document.getElementById("list")];

  function showWork(on) {
    workEls.forEach(function (el) { if (el) el.classList.toggle("hidden", !on); });
    if (gate) gate.classList.toggle("hidden", on);
  }

  function setAllowed(on) {
    showWork(!!on);
    localStorage.setItem("docsorter-on", on ? "1" : "0");
  }

  async function checkAccess() {
    try {
      var res = await fetch(ACCESS_URL + "&t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return;
      var meta = await res.json();
      var text = atob(String(meta.content || "").replace(/\n/g, ""));
      var data = JSON.parse(text);
      setAllowed(data && data.on !== false);
    } catch (e) {}
  }

  var cached = localStorage.getItem("docsorter-on");
  setAllowed(cached !== "0");
  checkAccess();
  setInterval(checkAccess, 45000);

  var drop = document.getElementById("drop");
  var filePick = document.getElementById("filePick");
  var runBtn = document.getElementById("runBtn");
  var clearBtn = document.getElementById("clearBtn");
  var statusEl = document.getElementById("status");
  var listEl = document.getElementById("list");
  var personInput = document.getElementById("personName");

  var queue = [];
  var busy = false;
  var incoming = [];
  var pumping = false;
  var lastSaved = null;

  var IMAGE_EXT = { jpg: 1, jpeg: 1, png: 1, webp: 1, bmp: 1, gif: 1, tif: 1, tiff: 1 };
  var SKIP_NAME = /(^|[\/\\])(\.|__macosx|thumbs\.db|desktop\.ini)/i;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function extOf(name) {
    var i = String(name || "").lastIndexOf(".");
    return i < 0 ? "" : name.slice(i + 1).toLowerCase();
  }

  function cleanPerson(name) {
    var n = String(name || "").replace(/\.(zip|alz|egg|7z|rar)$/i, "").trim();
    return n.replace(/[\\/:*?"<>|]/g, "").trim();
  }

  function currentPerson() {
    return cleanPerson(personInput && personInput.value) || "이름없음";
  }

  function setPerson(name) {
    if (personInput && name) personInput.value = name;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function render() {
    if (!listEl) return;
    listEl.innerHTML = queue.map(function (item) {
      return (
        '<div class="item"><span class="tag">' +
        escapeHtml(item.person || currentPerson()) +
        '</span><span class="tag">' +
        escapeHtml(item.folder || "대기") +
        "</span><span><b>" +
        escapeHtml(item.title || item.folder || "") +
        "</b>" +
        (item.name ? "  ←  " + escapeHtml(item.name) : "") +
        (item.note ? " · " + escapeHtml(item.note) : "") +
        "</span></div>"
      );
    }).join("");
    if (runBtn) runBtn.disabled = !lastSaved && !queue.some(function (x) { return x.blob; });
  }

  function addSkip(name, note, person) {
    queue.push({ name: name, folder: "건너뜀", title: "건너뜀", note: note || "", blob: null, person: person || currentPerson() });
    render();
  }

  function classifyByName(name) {
    var hit = (window.DocClassify && DocClassify.classify(name)) || { folder: "기타", title: "기타" };
    return { folder: hit.folder || "기타", title: hit.title || hit.folder || "기타" };
  }

  function isZipName(name) {
    return extOf(name) === "zip";
  }

  async function ingestZip(file, person) {
    person = person || cleanPerson(file.name) || currentPerson();
    setStatus(person + " 압축을 푸는 중…");
    var zip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (err) {
      addSkip(file.name, "압축을 열 수 없습니다. zip으로 다시 묶어 주세요.", person);
      return;
    }
    var names = Object.keys(zip.files);
    var found = 0;
    for (var i = 0; i < names.length; i++) {
      var path = names[i];
      var entry = zip.files[path];
      if (entry.dir || SKIP_NAME.test(path)) continue;
      var base = path.split("/").pop();
      var bytes = await entry.async("uint8array");
      var blob = new Blob([bytes], { type: "application/octet-stream" });
      if (isZipName(base || path)) {
        await ingestZip(new File([blob], base || path), cleanPerson(base) || person);
      } else {
        ingestOne(base || path, blob, person);
      }
      found += 1;
    }
    if (!found) addSkip(file.name, "압축 안에 파일이 없습니다.", person);
  }

  function ingestOne(name, blob, person) {
    person = person || currentPerson();
    var ext = extOf(name);
    if (ext === "alz" || ext === "egg" || ext === "7z" || ext === "rar") {
      addSkip(name, "zip으로 다시 압축해 주세요.", person);
      return;
    }
    if (!IMAGE_EXT[ext] && ext !== "pdf" && ext !== "xlsx" && ext !== "hwp" && ext !== "hwpx" && ext !== "doc" && ext !== "docx" && ext !== "png" && ext !== "jpg") {
      if (!ext) {
        addSkip(name, "지원하지 않는 형식", person);
        return;
      }
    }
    var hit = classifyByName(name);
    queue.push({
      name: name,
      folder: hit.folder,
      title: hit.title,
      note: "",
      blob: blob,
      person: person,
    });
    render();
  }

  function fileTitle(item) {
    var ext = extOf(item.name);
    var title = item.title || item.folder;
    return ext ? title + "." + ext : title;
  }

  function uniqueName(used, folder, name) {
    var key = folder + "/" + name;
    used[key] = (used[key] || 0) + 1;
    if (used[key] === 1) return name;
    var ext = extOf(name);
    var stem = ext ? name.slice(0, -(ext.length + 1)) : name;
    return stem + "_" + used[key] + (ext ? "." + ext : "");
  }

  async function downloadFolderZip(ready) {
    var zip = new JSZip();
    var used = {};
    ready.forEach(function (item) {
      var person = item.person || currentPerson();
      var titled = uniqueName(used, person + "/" + item.folder, fileTitle(item));
      var original = uniqueName(used, person + "/원본", item.name || titled);
      zip.folder("서류함").folder(person).folder(item.folder).file(titled, item.blob);
      zip.folder("서류함").folder(person).folder("원본").file(original, item.blob);
    });
    var blob = await zip.generateAsync({ type: "blob" });
    var firstPerson = (ready[0] && ready[0].person) || currentPerson();
    var fileName = firstPerson + "_서류함.zip";
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    lastSaved = { name: fileName, blob: blob, person: firstPerson };
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 8000);
    return fileName;
  }

  async function ingestFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    busy = true;
    if (runBtn) runBtn.disabled = true;
    try {
      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        if (SKIP_NAME.test(file.name)) continue;
        var ext = extOf(file.name);
        if (ext === "alz" || ext === "egg") {
          addSkip(file.name, "알집 전용 형식입니다. zip으로 다시 압축해 주세요.");
          continue;
        }
        if (isZipName(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed") {
          var zipPerson = cleanPerson(file.name) || currentPerson();
          setPerson(zipPerson);
          await ingestZip(file, zipPerson);
        } else {
          ingestOne(file.name, file, currentPerson());
        }
      }
      var ready = queue.filter(function (x) { return x.blob && x.folder && x.folder !== "건너뜀"; });
      if (!ready.length) {
        setStatus("정리할 사진·PDF가 없습니다. zip 안에 파일이 있는지 확인해 주세요.");
        return;
      }
      setStatus("분류 끝났습니다. 다운로드에 넣는 중…");
      var saved = await downloadFolderZip(ready);
      queue = [];
      render();
      setStatus("완료. 다운로드에서 " + saved + " 을 여세요. 다음 사람 알집을 놓으면 됩니다.");
    } catch (err) {
      setStatus("처리에 실패했습니다. zip을 다시 놓아 주세요.");
    } finally {
      busy = false;
      if (runBtn) runBtn.disabled = !lastSaved;
      render();
    }
  }

  async function takeFiles(files, dirReads) {
    files = Array.prototype.slice.call(files || []);
    setStatus(files.length ? (files[0].name + " 받는 중…") : "파일 받는 중…");
    if (dirReads && dirReads.length) {
      try {
        var extra = await Promise.all(dirReads);
        extra.forEach(function (arr) { files = files.concat(arr); });
      } catch (e) {}
    }
    var zipFile = files.filter(function (f) { return /\.zip$/i.test(f.name); })[0];
    if (zipFile) setPerson(cleanPerson(zipFile.name));
    await ingestFiles(files);
  }

  function acceptFiles(files, dirReads) {
    files = Array.prototype.slice.call(files || []);
    dirReads = dirReads || [];
    if (!files.length && !dirReads.length) {
      if (!busy && !pumping) setStatus("파일이 안 들어왔습니다. 「알집 고르기」로 선택해 주세요.");
      return;
    }
    incoming.push({ files: files, dirReads: dirReads });
    if (busy || pumping) setStatus("지금 정리 중입니다. 방금 넣은 알집은 끝나면 이어서 합니다.");
    pumpIncoming();
  }

  async function pumpIncoming() {
    if (pumping) return;
    pumping = true;
    try {
      while (incoming.length) {
        var job = incoming.shift();
        await takeFiles(job.files, job.dirReads);
      }
    } finally {
      pumping = false;
      busy = false;
    }
  }

  function snapshotDropped(dt) {
    var files = [];
    if (dt && dt.files && dt.files.length) {
      Array.prototype.forEach.call(dt.files, function (file) { files.push(file); });
    }
    if (!files.length && dt && dt.items && dt.items.length) {
      for (var i = 0; i < dt.items.length; i++) {
        var item = dt.items[i];
        if (item.kind !== "file") continue;
        var f = item.getAsFile ? item.getAsFile() : null;
        if (f) files.push(f);
      }
    }
    return files;
  }

  document.addEventListener("dragover", function (e) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    if (drop) drop.classList.add("over");
  }, true);
  document.addEventListener("dragleave", function (e) {
    if (drop && (e.target === document || e.target === document.documentElement)) drop.classList.remove("over");
  }, true);
  document.addEventListener("drop", function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (drop) drop.classList.remove("over");
    acceptFiles(snapshotDropped(e.dataTransfer));
  }, true);

  filePick.addEventListener("change", function () {
    var files = Array.prototype.slice.call(filePick.files || []);
    filePick.value = "";
    acceptFiles(files);
  });

  runBtn.addEventListener("click", async function () {
    if (lastSaved && lastSaved.blob) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(lastSaved.blob);
      a.download = lastSaved.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus("다시 받았습니다. 다운로드에서 " + lastSaved.name + " 을 여세요.");
      return;
    }
    var ready = queue.filter(function (x) { return x.blob && x.folder && x.folder !== "건너뜀"; });
    if (ready.length) {
      var saved = await downloadFolderZip(ready);
      setStatus("완료. 다운로드에서 " + saved + " 을 여세요.");
    }
  });

  clearBtn.addEventListener("click", function () {
    queue = [];
    lastSaved = null;
    if (personInput) personInput.value = "";
    render();
    setStatus("다음 사람 알집을 놓으세요.");
  });

  window.__docsorterAccept = acceptFiles;
  window.__docsorterStatus = function () {
    return statusEl ? statusEl.textContent : "";
  };
})();
