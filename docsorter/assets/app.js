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
    } catch (e) {
      var cached = localStorage.getItem("docsorter-on");
      if (cached === "0") setAllowed(false);
    }
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

  var queue = [];
  var worker = null;
  var busy = false;
  var dirHandle = null;

  var IMAGE_EXT = { jpg: 1, jpeg: 1, png: 1, webp: 1, bmp: 1, gif: 1, tif: 1, tiff: 1 };
  var SKIP_NAME = /(^|[\/\\])(\.|__macosx|thumbs\.db|desktop\.ini)/i;

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function extOf(name) {
    var i = name.lastIndexOf(".");
    return i < 0 ? "" : name.slice(i + 1).toLowerCase();
  }

  function addItem(name, folder, note) {
    queue.push({ name: name, folder: folder, note: note || "", blob: null });
    render();
  }

  function render() {
    listEl.innerHTML = queue.map(function (item) {
      return (
        '<div class="item"><span class="tag">' +
        escapeHtml(item.folder || "대기") +
        "</span><span><b>" +
        escapeHtml(item.title || item.folder || "") +
        "</b>" +
        (item.name ? "  ←  " + escapeHtml(item.name) : "") +
        (item.note ? " · " + escapeHtml(item.note) : "") +
        "</span></div>"
      );
    }).join("");
    runBtn.disabled = !queue.some(function (x) { return x.blob && x.folder; });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = Tesseract.createWorker("kor+eng", 1, {
      workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
      corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core.wasm.js",
      langPath: "https://tessdata.projectnaptha.com/4.0.0"
    });
    return worker;
  }

  async function ocrImageSource(src) {
    var w = await ensureWorker();
    var result = await w.recognize(src);
    return (result && result.data && result.data.text) || "";
  }

  async function ocrPdf(buffer) {
    var pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    var page = await pdf.getPage(1);
    var viewport = page.getViewport({ scale: 2 });
    var canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: viewport }).promise;
    var textContent = await page.getTextContent();
    var embedded = textContent.items.map(function (it) { return it.str; }).join(" ");
    if (DocClassify.normalize(embedded).length >= 20) return embedded;
    return ocrImageSource(canvas);
  }

  async function textFromXlsx(buffer) {
    var zip = await JSZip.loadAsync(buffer);
    var parts = [];
    var files = Object.keys(zip.files);
    for (var i = 0; i < files.length; i++) {
      var name = files[i];
      if (name.indexOf("xl/") === 0 && name.slice(-4) === ".xml") {
        parts.push(await zip.files[name].async("string"));
      }
    }
    return parts.join("\n").replace(/<[^>]+>/g, " ");
  }

  async function classifyBlob(name, blob) {
    var ext = extOf(name);
    var text = "";
    if (IMAGE_EXT[ext]) {
      text = await ocrImageSource(blob);
    } else if (ext === "pdf") {
      text = await ocrPdf(await blob.arrayBuffer());
    } else if (ext === "xlsx") {
      text = (await textFromXlsx(await blob.arrayBuffer())) + "\n" + name;
    } else if (ext === "hwp" || ext === "hwpx") {
      text = name;
    } else {
      return null;
    }
    var hit = DocClassify.classify(text);
    return { folder: hit.folder, title: hit.title || hit.folder, text: text };
  }

  async function ingestFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    busy = true;
    runBtn.disabled = true;
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (SKIP_NAME.test(file.name)) continue;
      if (extOf(file.name) === "zip") {
        await ingestZip(file);
      } else {
        await ingestOne(file.name, file);
      }
    }
    busy = false;
    render();
    var ready = queue.filter(function (x) { return x.blob && x.folder && x.folder !== "건너뜀"; });
    if (ready.length) {
      setStatus("읽기 완료. 서류함 폴더에 넣는 중…");
      try {
        await writeFilesToDir(dirHandle, ready);
        runBtn.disabled = false;
        setStatus("완료. 서류함 안에 초본·등본 폴더가 생기고, 파일은 등본.jpg처럼 각각 저장됐습니다.");
      } catch (err) {
        runBtn.disabled = false;
        await downloadFolderZip(ready);
      }
    } else {
      setStatus("완료. 정리할 사진·PDF가 없습니다.");
    }
  }

  async function ingestZip(file) {
    setStatus(file.name + " 압축을 푸는 중…");
    var zip = await JSZip.loadAsync(file);
    var names = Object.keys(zip.files);
    for (var i = 0; i < names.length; i++) {
      var path = names[i];
      var entry = zip.files[path];
      if (entry.dir || SKIP_NAME.test(path)) continue;
      var base = path.split("/").pop();
      var blob = await entry.async("blob");
      blob = new Blob([blob], { type: blob.type || "application/octet-stream" });
      await ingestOne(base || path, blob);
    }
  }

  async function ingestOne(name, blob) {
    setStatus(name + " 글자를 읽는 중…");
    try {
      var hit = await classifyBlob(name, blob);
      if (!hit) {
        addItem(name, "건너뜀", "지원하지 않는 형식");
        return;
      }
      queue.push({ name: name, folder: hit.folder, title: hit.title || hit.folder, note: "", blob: blob });
      render();
    } catch (err) {
      queue.push({ name: name, folder: "기타", title: "기타", note: "읽기 실패", blob: blob });
      render();
    }
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
      req.onupgradeneeded = function () {
        req.result.createObjectStore("handles");
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
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
      if (!handle) return null;
      var perm = await handle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted") {
        perm = await handle.requestPermission({ mode: "readwrite" });
      }
      return perm === "granted" ? handle : null;
    } catch (e) {
      return null;
    }
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

  async function downloadFolderZip(ready) {
    var zip = new JSZip();
    var used = {};
    ready.forEach(function (item) {
      var name = uniqueName(used, item.folder, fileTitle(item));
      zip.folder(item.folder).file(name, item.blob);
    });
    var blob = await zip.generateAsync({ type: "blob" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "서류함.zip";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    setStatus("완료. 서류함.zip 이 받아졌습니다. 풀면 초본·등본 폴더와 파일이 각각 들어 있습니다.");
  }

  async function writeFilesToDir(handle, ready) {
    var used = {};
    for (var i = 0; i < ready.length; i++) {
      var item = ready[i];
      var folder = await handle.getDirectoryHandle(item.folder, { create: true });
      var name = uniqueName(used, item.folder, fileTitle(item));
      var file = await folder.getFileHandle(name, { create: true });
      var writable = await file.createWritable();
      await writable.write(item.blob);
      await writable.close();
    }
  }

  async function pickCabinetNow() {
    if (!window.showDirectoryPicker) {
      throw new Error("no-picker");
    }
    if (dirHandle) {
      try {
        var perm = await dirHandle.queryPermission({ mode: "readwrite" });
        if (perm !== "granted") perm = await dirHandle.requestPermission({ mode: "readwrite" });
        if (perm === "granted") return dirHandle;
      } catch (e) {}
    }
    dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    await storeDirHandle(dirHandle);
    return dirHandle;
  }

  async function startFromGesture(fileList) {
    try {
      setStatus("먼저 저장할 「서류함」 폴더를 선택하세요.");
      await pickCabinetNow();
    } catch (err) {
      if (err && err.name === "AbortError") {
        setStatus("서류함 폴더를 선택해야 저장됩니다. 다시 넣어 주세요.");
        return;
      }
      setStatus("폴더를 열 수 없습니다. 크롬에서 다시 넣어 주세요.");
      return;
    }
    await ingestFiles(fileList);
  }

  async function saveToComputer(ready) {
    try {
      await pickCabinetNow();
      await writeFilesToDir(dirHandle, ready);
      runBtn.disabled = false;
      setStatus("완료. 서류함 안에 초본·등본 폴더가 생기고, 파일은 등본.jpg처럼 각각 저장됐습니다.");
    } catch (err) {
      runBtn.disabled = false;
      if (err && err.name === "AbortError") {
        setStatus("폴더 선택을 취소했습니다. 「서류함에 다시 넣기」를 누르면 됩니다.");
        return;
      }
      await downloadFolderZip(ready);
    }
  }

  drop.addEventListener("dragover", function (e) {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", function () { drop.classList.remove("over"); });
  drop.addEventListener("drop", function (e) {
    e.preventDefault();
    drop.classList.remove("over");
    if (!busy) startFromGesture(e.dataTransfer.files);
  });
  filePick.addEventListener("change", function () {
    if (!busy) startFromGesture(filePick.files);
    filePick.value = "";
  });
  runBtn.addEventListener("click", function () {
    if (busy) return;
    var ready = queue.filter(function (x) { return x.blob && x.folder && x.folder !== "건너뜀"; });
    if (ready.length) saveToComputer(ready);
  });

  clearBtn.addEventListener("click", function () {
    if (busy) return;
    queue = [];
    render();
    setStatus("파일을 넣으면 자동으로 읽기 시작합니다.");
  });
})();
