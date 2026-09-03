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
  var personInput = document.getElementById("personName");

  var queue = [];
  var worker = null;
  var busy = false;
  var outDir = null;
  var incoming = [];
  var pumping = false;
  var justDropped = 0;

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

  function cleanPerson(name) {
    var n = String(name || "").replace(/\.(zip|alz|egg)$/i, "").trim();
    n = n.replace(/[\\/:*?"<>|]/g, "").trim();
    return n;
  }

  function currentPerson() {
    return cleanPerson(personInput && personInput.value) || "이름없음";
  }

  function setPerson(name) {
    if (personInput && name) personInput.value = name;
  }

  function addItem(name, folder, note, person) {
    queue.push({ name: name, folder: folder, note: note || "", blob: null, person: person || currentPerson() });
    render();
  }

  function render() {
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

  async function isZipBlob(file) {
    var ext = extOf(file.name);
    if (ext === "xlsx" || ext === "docx" || ext === "hwpx" || ext === "hwp") return false;
    if (ext === "zip") return true;
    if (file.type === "application/zip" || file.type === "application/x-zip-compressed") return true;
    if (ext) return false;
    try {
      var buf = await file.slice(0, 4).arrayBuffer();
      var u = new Uint8Array(buf);
      return u[0] === 0x50 && u[1] === 0x4b && (u[2] === 0x03 || u[2] === 0x05 || u[2] === 0x07);
    } catch (e) {
      return false;
    }
  }

  function readDirectoryEntry(entry) {
    return new Promise(function (resolve) {
      var out = [];
      var reader = entry.createReader();
      function next() {
        reader.readEntries(function (entries) {
          if (!entries.length) {
            Promise.all(out).then(function (chunks) {
              resolve(chunks.reduce(function (a, b) { return a.concat(b); }, []));
            });
            return;
          }
          entries.forEach(function (child) {
            if (child.isDirectory) {
              out.push(readDirectoryEntry(child));
            } else {
              out.push(new Promise(function (ok) {
                child.file(function (f) { ok([f]); }, function () { ok([]); });
              }));
            }
          });
          next();
        }, function () { resolve([]); });
      }
      next();
    });
  }

  function isArchiveName(name) {
    var ext = extOf(name);
    return ext === "zip" || ext === "alz" || ext === "egg" || ext === "7z" || ext === "rar";
  }

  function sameFile(a, b) {
    return a && b && a.name === b.name && a.size === b.size;
  }

  function snapshotDropped(dt) {
    var files = [];
    var dirReads = [];
    if (dt && dt.items && dt.items.length) {
      for (var i = 0; i < dt.items.length; i++) {
        var item = dt.items[i];
        if (item.kind !== "file") continue;
        var f = item.getAsFile ? item.getAsFile() : null;
        if (f && isArchiveName(f.name)) {
          files.push(f);
          continue;
        }
        var entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
        if (entry && entry.isDirectory) {
          dirReads.push(readDirectoryEntry(entry));
        } else if (f) {
          files.push(f);
        }
      }
    }
    if (dt && dt.files && dt.files.length) {
      Array.prototype.forEach.call(dt.files, function (file) {
        if (!files.some(function (x) { return sameFile(x, file); })) files.push(file);
      });
    }
    return { files: files, dirReads: dirReads };
  }

  async function ingestFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    busy = true;
    runBtn.disabled = true;
    try {
      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        if (SKIP_NAME.test(file.name)) continue;
        var ext = extOf(file.name);
        if (ext === "alz" || ext === "egg") {
          addItem(file.name, "건너뜀", "알집 전용 형식입니다. zip으로 다시 압축해 주세요.");
          continue;
        }
        if (await isZipBlob(file)) {
          var zipPerson = cleanPerson(file.name) || currentPerson();
          setPerson(zipPerson);
          await ingestZip(file, zipPerson);
        } else {
          await ingestOne(file.name, file, currentPerson());
        }
      }
      render();
      var ready = queue.filter(function (x) { return x.blob && x.folder && x.folder !== "건너뜀"; });
      if (ready.length) {
        setStatus("분류 끝났습니다. 다운로드 폴더에 넣는 중…");
        await saveToComputer(ready);
      } else {
        setStatus("완료. 정리할 사진·PDF가 없습니다.");
      }
    } catch (err) {
      runBtn.disabled = false;
      setStatus("압축을 풀지 못했습니다. zip 파일을 다시 놓아 주세요.");
    } finally {
      busy = false;
      render();
    }
  }

  async function ingestZip(file, person) {
    person = person || cleanPerson(file.name) || currentPerson();
    setStatus(person + " 압축을 푸는 중…");
    var zip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (err) {
      addItem(file.name, "건너뜀", "압축을 열 수 없습니다. zip으로 다시 묶어 주세요.", person);
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
      if (extOf(base || path) === "zip") {
        await ingestZip(new File([blob], base || path), cleanPerson(base) || person);
      } else {
        await ingestOne(base || path, blob, person);
      }
      found += 1;
    }
    if (!found) {
      addItem(file.name, "건너뜀", "압축 안에 사진·PDF가 없습니다.", person);
    }
  }

  async function ingestOne(name, blob, person) {
    person = person || currentPerson();
    setStatus(person + " · " + name + " 글자를 읽는 중…");
    try {
      var hit = await classifyBlob(name, blob);
      if (!hit) {
        addItem(name, "건너뜀", "지원하지 않는 형식", person);
        return;
      }
      queue.push({ name: name, folder: hit.folder, title: hit.title || hit.folder, note: "", blob: blob, person: person });
      render();
    } catch (err) {
      queue.push({ name: name, folder: "기타", title: "기타", note: "읽기 실패", blob: blob, person: person });
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
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    var firstPerson = (ready[0] && ready[0].person) || currentPerson();
    a.download = firstPerson + "_서류함.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    setStatus("다운로드 폴더에 " + firstPerson + "_서류함.zip 이 생겼습니다. 파인더에서 다운로드를 열어 보세요.");
  }

  function openIdb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open("docsorter", 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore("kv");
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function loadOutDir() {
    try {
      var db = await openIdb();
      var handle = await new Promise(function (resolve, reject) {
        var g = db.transaction("kv", "readonly").objectStore("kv").get("outdir");
        g.onsuccess = function () { resolve(g.result || null); };
        g.onerror = function () { reject(g.error); };
      });
      if (!handle || !handle.queryPermission) return null;
      var perm = await handle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted") {
        perm = await handle.requestPermission({ mode: "readwrite" });
      }
      return perm === "granted" ? handle : null;
    } catch (e) {
      return null;
    }
  }

  async function rememberOutDir(handle) {
    try {
      var db = await openIdb();
      await new Promise(function (resolve, reject) {
        var tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(handle, "outdir");
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error); };
      });
    } catch (e) {}
  }

  async function ensureOutDir() {
    if (outDir) {
      try {
        var perm = await outDir.queryPermission({ mode: "readwrite" });
        if (perm === "granted") return outDir;
      } catch (e) {
        outDir = null;
      }
    }
    outDir = await loadOutDir();
    if (outDir) return outDir;
    if (!window.showDirectoryPicker) return null;
    try {
      setStatus("한 번만: 창에서 「다운로드」를 고르세요. 홈·바탕화면은 안 됩니다.");
      var handle = await window.showDirectoryPicker({
        id: "docsorter-dl",
        mode: "readwrite",
        startIn: "downloads",
      });
      outDir = handle;
      await rememberOutDir(handle);
      return handle;
    } catch (e) {
      return null;
    }
  }

  async function writeBlob(dir, name, blob) {
    var file = await dir.getFileHandle(name, { create: true });
    var writable = await file.createWritable();
    var buf = blob instanceof Blob ? await blob.arrayBuffer() : blob;
    await writable.write(buf);
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
      var titled = uniqueName(used, person + "/" + item.folder, fileTitle(item));
      var original = uniqueName(used, person + "/원본", item.name || titled);
      await writeBlob(folder, titled, item.blob);
      await writeBlob(origDir, original, item.blob);
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
    if (!outDir) outDir = await loadOutDir();
    await ingestFiles(files);
  }

  async function saveToComputer(ready) {
    runBtn.disabled = true;
    setStatus("다운로드 폴더에 넣는 중…");
    try {
      if (outDir) {
        try { await writeFilesToDir(outDir, ready); } catch (e) { outDir = null; }
      }
      await downloadFolderZip(ready);
      var who = (ready[0] && ready[0].person) || currentPerson();
      queue = [];
      if (personInput) personInput.value = "";
      render();
      setStatus("완료. 다운로드에 " + who + "_서류함.zip 이 있습니다. 다음 사람 알집을 놓으세요.");
    } catch (err) {
      runBtn.disabled = false;
      setStatus("자동 저장이 막혔습니다. 「다시 받기」를 누르거나 알집을 다시 놓으세요.");
    }
  }

  function acceptFiles(files, dirReads) {
    files = Array.prototype.slice.call(files || []);
    dirReads = dirReads || [];
    if (!files.length && !dirReads.length) {
      if (!busy && !pumping) setStatus("파일이 안 들어왔습니다. 「알집 고르기」로 다시 선택해 주세요.");
      return;
    }
    incoming.push({ files: files, dirReads: dirReads });
    if (busy || pumping) {
      setStatus("지금 정리 중입니다. 방금 넣은 알집은 끝나면 이어서 합니다.");
    }
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

  document.addEventListener("dragover", function (e) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    drop.classList.add("over");
  }, true);
  document.addEventListener("dragleave", function (e) {
    if (e.target === document || e.target === document.documentElement) drop.classList.remove("over");
  }, true);
  document.addEventListener("drop", function (e) {
    e.preventDefault();
    e.stopPropagation();
    drop.classList.remove("over");
    justDropped = Date.now();
    var snapped = snapshotDropped(e.dataTransfer);
    acceptFiles(snapped.files, snapped.dirReads);
    filePick.value = "";
  }, true);
  filePick.addEventListener("change", function () {
    var files = Array.prototype.slice.call(filePick.files || []);
    filePick.value = "";
    if (Date.now() - justDropped < 1000) return;
    acceptFiles(files);
  });
  runBtn.addEventListener("click", function () {
    var ready = queue.filter(function (x) { return x.blob && x.folder && x.folder !== "건너뜀"; });
    if (ready.length) saveToComputer(ready);
  });

  clearBtn.addEventListener("click", function () {
    if (busy) return;
    queue = [];
    if (personInput) personInput.value = "";
    render();
    setStatus("다음 사람 알집을 놓으세요.");
  });
})();
