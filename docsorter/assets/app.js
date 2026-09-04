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
  var dirHandle = null;
  var personUsed = {};

  var IMAGE_EXT = { jpg: 1, jpeg: 1, png: 1, webp: 1, bmp: 1, gif: 1, tif: 1, tiff: 1 };
  var SKIP_NAME = /(^|[\/\\])(\.|__macosx|thumbs\.db|desktop\.ini)/i;
  var worker = null;
  var progress = { done: 0, total: 0, person: "" };
  var OCR_MS = 25000;

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  }

  function setStatus(text) {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.classList.toggle("working", /중|받는|넣|준비/.test(String(text || "")));
    }
  }

  function progressLabel(name, extra) {
    var who = progress.person ? progress.person + " · " : "";
    var count = progress.total ? progress.done + "/" + progress.total + " · " : "";
    return who + count + (extra || ((name || "파일") + " 읽는 중…"));
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

  function uniquePerson(name) {
    return cleanPerson(name) || currentPerson() || "이름없음";
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
    return { folder: hit.folder || "기타", title: hit.title || hit.folder || "기타", score: hit.score || 0 };
  }

  function nameLooksWeak(name) {
    var stem = String(name || "").replace(/\.[^.]+$/, "").replace(/\s/g, "");
    if (!stem) return true;
    if (/^(img|dsc|photo|image|사진|캡처|screenshot|파일)[_-]?\d*$/i.test(stem)) return true;
    if (/^[\d._\-()]+$/.test(stem)) return true;
    return false;
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error("timeout")); }, ms);
      })
    ]);
  }

  async function ensureWorker() {
    if (worker) return worker;
    setStatus("글자 인식 파일을 받는 중… 처음 한 번만 1~2분 걸립니다. 멈춘 게 아닙니다.");
    worker = await Tesseract.createWorker("kor+eng", 1, {
      workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
      corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core.wasm.js",
      langPath: "https://tessdata.projectnaptha.com/4.0.0",
      logger: function (m) {
        if (!m || !m.status) return;
        if (String(m.status).indexOf("loading language") >= 0) {
          var pct = m.progress ? Math.round(m.progress * 100) : 0;
          setStatus("글자 인식 파일을 받는 중… " + (pct ? pct + "%" : "처음 한 번만 1~2분") + ". 멈춘 게 아닙니다.");
        }
      }
    });
    return worker;
  }

  function shrinkImage(src) {
    return new Promise(function (resolve) {
      var blob = src instanceof Blob ? src : new Blob([src]);
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        var max = 1280;
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        if (w > max || h > max) {
          var scale = max / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, w);
        canvas.height = Math.max(1, h);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (out) { resolve(out || blob); }, "image/jpeg", 0.82);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        resolve(blob);
      };
      img.src = url;
    });
  }

  async function ocrBlob(src) {
    var w = await ensureWorker();
    var small = await shrinkImage(src);
    var result = await withTimeout(w.recognize(small), OCR_MS);
    return (result && result.data && result.data.text) || "";
  }

  async function ocrPdf(bytes) {
    var copy = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var pdf = await pdfjsLib.getDocument({ data: copy }).promise;
    var page = await pdf.getPage(1);
    var base = page.getViewport({ scale: 1 });
    var scale = Math.min(1.6, 1280 / Math.max(base.width, 1));
    var viewport = page.getViewport({ scale: scale });
    var canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: viewport }).promise;
    var textContent = await page.getTextContent();
    var embedded = textContent.items.map(function (it) { return it.str; }).join(" ");
    if (window.DocClassify && DocClassify.normalize(embedded).length >= 20) return embedded;
    return ocrBlob(canvas);
  }

  async function textFromXlsx(bytes) {
    var zip = await JSZip.loadAsync(bytes);
    var parts = [];
    var files = Object.keys(zip.files);
    for (var i = 0; i < files.length; i++) {
      var fname = files[i];
      if (fname.indexOf("xl/") === 0 && fname.slice(-4) === ".xml") {
        parts.push(await zip.files[fname].async("string"));
      }
    }
    return parts.join("\n").replace(/<[^>]+>/g, " ");
  }

  async function classifySmart(name, bytes) {
    var byName = classifyByName(name);
    if (!nameLooksWeak(name) && byName.folder !== "기타" && (byName.score || 0) >= 70) {
      setStatus(progressLabel(name, (name || "파일") + " → " + byName.folder));
      return { folder: byName.folder, title: byName.title };
    }
    var ext = extOf(name);
    var text = String(name || "");
    try {
      setStatus(progressLabel(name));
      if (IMAGE_EXT[ext]) text = (await ocrBlob(new Blob([bytes]))) + "\n" + name;
      else if (ext === "pdf") text = (await ocrPdf(bytes)) + "\n" + name;
      else if (ext === "xlsx") text = (await textFromXlsx(bytes)) + "\n" + name;
    } catch (e) {
      return { folder: byName.folder || "기타", title: byName.title || "기타" };
    }
    var hit = (window.DocClassify && DocClassify.classify(text)) || { folder: "기타", title: "기타" };
    return { folder: hit.folder || "기타", title: hit.title || hit.folder || "기타" };
  }

  function isZipName(name) {
    return extOf(name) === "zip";
  }

  function decodeZipName(bytes) {
    var arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var utf8 = new TextDecoder("utf-8").decode(arr);
    if (/[가-힣]/.test(utf8) && utf8.indexOf("\uFFFD") < 0) return utf8;
    try {
      var kr = new TextDecoder("euc-kr").decode(arr);
      if (/[가-힣]/.test(kr)) return kr;
    } catch (e) {}
    return utf8;
  }

  async function collectZipFiles(file, person, out) {
    var zip;
    try {
      zip = await JSZip.loadAsync(file, { decodeFileName: decodeZipName });
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
      var bytes = new Uint8Array(await entry.async("uint8array"));
      if (isZipName(base || path)) {
        await collectZipFiles(new File([bytes], base || path), person, out);
      } else {
        out.push({ name: base || path, bytes: bytes, person: person });
      }
      found += 1;
    }
    if (!found) addSkip(file.name, "압축 안에 파일이 없습니다.", person);
  }

  async function ingestZip(file, person) {
    person = person || cleanPerson(file.name) || currentPerson();
    progress.person = person;
    setStatus(person + " 압축을 푸는 중… 파일이 많으면 잠시 걸립니다.");
    var items = [];
    await collectZipFiles(file, person, items);
    progress.total += items.length;
    for (var i = 0; i < items.length; i++) {
      progress.done += 1;
      await ingestOne(items[i].name, items[i].bytes, items[i].person);
    }
  }

  async function ingestOne(name, bytes, person) {
    person = person || currentPerson();
    var ext = extOf(name);
    if (ext === "alz" || ext === "egg" || ext === "7z" || ext === "rar") {
      addSkip(name, "zip으로 다시 압축해 주세요.", person);
      return;
    }
    var copy = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var hit = await classifySmart(name, copy);
    queue.push({
      name: name,
      folder: hit.folder,
      title: hit.title,
      note: "",
      bytes: copy,
      blob: new Blob([copy], { type: "application/octet-stream" }),
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

  function openHandleDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open("docsorter-cabinet", 1);
      req.onupgradeneeded = function () { req.result.createObjectStore("handles"); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function storeDirHandle(handle) {
    try {
      var db = await openHandleDb();
      await new Promise(function (resolve, reject) {
        var tx = db.transaction("handles", "readwrite");
        tx.objectStore("handles").put(handle, "cabinet");
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error); };
      });
      db.close();
    } catch (e) {}
  }

  async function loadDirHandle() {
    try {
      var db = await openHandleDb();
      var handle = await new Promise(function (resolve, reject) {
        var tx = db.transaction("handles", "readonly");
        var q = tx.objectStore("handles").get("cabinet");
        q.onsuccess = function () { resolve(q.result || null); };
        q.onerror = function () { reject(q.error); };
      });
      db.close();
      return handle || null;
    } catch (e) {
      return null;
    }
  }

  async function ensureCabinetFromGesture() {
    if (!window.showDirectoryPicker) throw new Error("no-picker");
    if (!dirHandle) dirHandle = await loadDirHandle();
    if (dirHandle) {
      var perm = await dirHandle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted") perm = await dirHandle.requestPermission({ mode: "readwrite" });
      if (perm === "granted") return dirHandle;
    }
    setStatus("처음 한 번만 바탕화면을 고르세요. 서류함이 거기에 생깁니다.");
    dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    await storeDirHandle(dirHandle);
    return dirHandle;
  }

  async function writeBlob(dir, name, item) {
    var file = await dir.getFileHandle(name, { create: true });
    var writable = await file.createWritable();
    var data = item.bytes || item.blob;
    await writable.write(data);
    await writable.close();
  }

  async function writeFilesToDir(handle, ready) {
    var root = handle;
    if (handle.name !== "서류함") {
      root = await handle.getDirectoryHandle("서류함", { create: true });
    }
    var used = {};
    for (var i = 0; i < ready.length; i++) {
      var item = ready[i];
      var person = item.person || currentPerson();
      var personDir = await root.getDirectoryHandle(person, { create: true });
      var folder = await personDir.getDirectoryHandle(item.folder, { create: true });
      var origDir = await personDir.getDirectoryHandle("원본", { create: true });
      var original = uniqueName(used, person + "/원본", item.name || fileTitle(item));
      var inFolder = uniqueName(used, person + "/" + item.folder, fileTitle(item));
      await writeBlob(folder, inFolder, item);
      await writeBlob(origDir, original, item);
    }
  }

  async function saveToCabinet(ready) {
    setStatus("지금 뜨는 창에서 바탕화면을 고르세요. 알집이 아닙니다.");
    try {
      if (!window.showDirectoryPicker) throw new Error("no-picker");
      var handle = await window.showDirectoryPicker({ mode: "readwrite" });
      await writeFilesToDir(handle, ready);
      var saved = (ready[0] && ready[0].person) || currentPerson();
      lastSaved = { person: saved, ready: ready };
      setStatus("완료. 서류함 → " + saved + " 폴더에 넣어 두었습니다. 다음 사람 알집을 놓으면 됩니다.");
    } catch (err) {
      if (err && err.name === "AbortError") {
        setStatus("폴더 선택을 취소했습니다. 「서류함에 넣기」를 다시 누르면 됩니다.");
        return;
      }
      setStatus("폴더에 넣지 못했습니다. 「서류함에 넣기」를 다시 눌러 주세요.");
    }
  }

  async function ingestFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    busy = true;
    if (runBtn) runBtn.disabled = true;
    var startAt = queue.length;
    progress = { done: 0, total: 0, person: currentPerson() };
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
          var zipPerson = uniquePerson(file.name);
          setPerson(zipPerson);
          await ingestZip(file, zipPerson);
        } else {
          progress.total += 1;
          progress.done += 1;
          var buf = await file.arrayBuffer();
          await ingestOne(file.name, new Uint8Array(buf), currentPerson());
        }
      }
      var ready = queue.slice(startAt).filter(function (x) { return x.blob && x.folder && x.folder !== "건너뜀"; });
      if (!ready.length) {
        setStatus("정리할 사진·PDF가 없습니다. zip 안에 파일이 있는지 확인해 주세요.");
        return;
      }
      lastSaved = { ready: ready, person: (ready[0] && ready[0].person) || currentPerson() };
      if (!dirHandle) throw new Error("no-cabinet");
      setStatus("서류함에 넣는 중…");
      await writeFilesToDir(dirHandle, ready);
      if (runBtn) runBtn.disabled = false;
      setStatus("완료. 서류함 → " + lastSaved.person + " 폴더에 넣어 두었습니다. 다음 사람 알집을 놓으면 됩니다.");
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
    try {
      await ensureCabinetFromGesture();
    } catch (err) {
      if (err && err.name === "AbortError") {
        setStatus("바탕화면을 골라야 서류함에 들어갑니다. 다시 놓아 주세요.");
        return;
      }
      setStatus("폴더를 열 수 없습니다. 크롬에서 다시 놓아 주세요.");
      return;
    }
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
  document.addEventListener("drop", async function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (drop) drop.classList.remove("over");
    var files = snapshotDropped(e.dataTransfer);
    try {
      await ensureCabinetFromGesture();
    } catch (err) {
      if (err && err.name === "AbortError") {
        setStatus("바탕화면을 골라야 서류함에 들어갑니다. 다시 놓아 주세요.");
        return;
      }
      setStatus("폴더를 열 수 없습니다. 크롬에서 다시 놓아 주세요.");
      return;
    }
    acceptFiles(files);
  }, true);

  filePick.addEventListener("change", async function () {
    var files = Array.prototype.slice.call(filePick.files || []);
    filePick.value = "";
    try {
      await ensureCabinetFromGesture();
    } catch (err) {
      if (err && err.name === "AbortError") {
        setStatus("바탕화면을 골라야 서류함에 들어갑니다. 다시 골라 주세요.");
        return;
      }
      setStatus("폴더를 열 수 없습니다. 크롬에서 다시 골라 주세요.");
      return;
    }
    acceptFiles(files);
  });

  runBtn.addEventListener("click", async function () {
    if (busy) return;
    var ready = (lastSaved && lastSaved.ready) || queue.filter(function (x) { return x.blob && x.folder && x.folder !== "건너뜀"; });
    if (!ready.length) return;
    try {
      await ensureCabinetFromGesture();
      await writeFilesToDir(dirHandle, ready);
      setStatus("완료. 서류함 → " + ((ready[0] && ready[0].person) || currentPerson()) + " 폴더에 넣어 두었습니다.");
    } catch (err) {
      if (err && err.name === "AbortError") {
        setStatus("바탕화면을 골라야 서류함에 들어갑니다.");
        return;
      }
      setStatus("서류함에 넣지 못했습니다. 「서류함에 넣기」를 다시 눌러 주세요.");
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
