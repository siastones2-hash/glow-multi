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
    if (!files.length) {
      setStatus("파일이 들어오지 않았습니다. 알집 zip을 이 창에 다시 놓아 주세요.");
      return;
    }
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
          await ingestZip(file);
        } else {
          await ingestOne(file.name, file);
        }
      }
      render();
      var ready = queue.filter(function (x) { return x.blob && x.folder && x.folder !== "건너뜀"; });
      if (ready.length) {
        runBtn.disabled = false;
        setStatus("읽기 끝났습니다. 「내 컴퓨터에 폴더로 저장」을 누르세요. 지금 뜨는 창에서 바탕화면을 고르면 됩니다.");
      } else {
        setStatus("완료. 정리할 사진·PDF가 없습니다.");
      }
    } catch (err) {
      runBtn.disabled = false;
      setStatus("압축을 풀지 못했습니다. zip 파일을 다시 놓아 주세요.");
    }
    busy = false;
    render();
  }

  async function ingestZip(file) {
    setStatus(file.name + " 압축을 푸는 중…");
    var zip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (err) {
      addItem(file.name, "건너뜀", "압축을 열 수 없습니다. zip으로 다시 묶어 주세요.");
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
        await ingestZip(new File([blob], base || path));
      } else {
        await ingestOne(base || path, blob);
      }
      found += 1;
    }
    if (!found) {
      addItem(file.name, "건너뜀", "압축 안에 사진·PDF가 없습니다.");
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

  async function downloadFolderZip(ready) {
    var zip = new JSZip();
    var used = {};
    ready.forEach(function (item) {
      var titled = uniqueName(used, item.folder, fileTitle(item));
      var original = uniqueName(used, "원본", item.name || titled);
      zip.folder("서류함").folder(item.folder).file(titled, item.blob);
      zip.folder("서류함").folder("원본").file(original, item.blob);
    });
    var blob = await zip.generateAsync({ type: "blob" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "서류함.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    setStatus("완료. 서류함.zip 이 받아졌습니다. 풀면 초본·등본 폴더가 들어 있습니다.");
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
    var origDir = await root.getDirectoryHandle("원본", { create: true });
    for (var i = 0; i < ready.length; i++) {
      var item = ready[i];
      var folder = await root.getDirectoryHandle(item.folder, { create: true });
      var titled = uniqueName(used, item.folder, fileTitle(item));
      var original = uniqueName(used, "원본", item.name || titled);
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
    await ingestFiles(files);
  }

  async function saveToComputer(ready) {
    runBtn.disabled = false;
    setStatus("지금 뜨는 창에서 저장할 폴더를 고르세요. 알집이 아닙니다. 바탕화면을 선택하면 됩니다.");
    try {
      if (!window.showDirectoryPicker) throw new Error("no-picker");
      var handle = await window.showDirectoryPicker({ mode: "readwrite" });
      await writeFilesToDir(handle, ready);
      setStatus("완료. 고른 위치에 「서류함」이 생겼고, 안에 초본·등본 폴더와 파일이 들어 있습니다.");
    } catch (err) {
      if (err && err.name === "AbortError") {
        await downloadFolderZip(ready);
        return;
      }
      await downloadFolderZip(ready);
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
    var snapped = snapshotDropped(e.dataTransfer);
    if (!busy) takeFiles(snapped.files, snapped.dirReads);
  }, true);
  filePick.addEventListener("change", function () {
    var files = Array.prototype.slice.call(filePick.files || []);
    filePick.value = "";
    if (!busy) takeFiles(files);
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
