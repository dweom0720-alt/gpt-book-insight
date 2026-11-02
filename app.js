const API_BASE = "https://gptbook-insight.dweom0720.workers.dev"; // 배포 후 본인의 Worker 주소로 변경
const $ = (id) => document.getElementById(id);
let extractedText = "";
let currentAnalysis = "";
let currentBook = null;
let pdfjsLibRef = null;

try {
  const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs");
  pdfjsLibRef = pdfjs;
  pdfjsLibRef.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
} catch (e) { console.warn("PDF.js load failed", e); }

if (window.mermaid) mermaid.initialize({startOnLoad:false, theme:"neutral", securityLevel:"strict"});

function setSource(message) { $("sourceInfo").textContent = message; }
function escapeHtml(s="") { return s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function renderPlainText(text) {
  // 모델 출력은 HTML로 실행하지 않고 텍스트로 안전하게 표시합니다.
  $("analysisOutput").textContent = text;
}
function setSelectedBook(book) {
  currentBook = book;
  $("titleInput").value = book.title || "";
  $("authorInput").value = (book.authors || []).join(", ");
  if (book.category) $("categoryInput").value = book.category;
}
function enableAnalysis() {
  $("analyzeBtn").disabled = !(extractedText.trim().length > 300 && $("titleInput").value.trim());
}

async function searchBooks() {
  const q = $("bookSearch").value.trim();
  if (!q) return;
  $("searchStatus").textContent = "도서를 검색하고 있습니다…";
  $("searchResults").innerHTML = "";
  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=8&printType=books`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Google Books 검색 실패");
    const data = await res.json();
    const items = (data.items || []).map(v => {
      const i = v.volumeInfo || {};
      return {title:i.title || "제목 정보 없음", authors:i.authors || [], publisher:i.publisher || "", publishedDate:i.publishedDate || "", description:i.description || "", thumbnail:(i.imageLinks?.thumbnail || "").replace("http://","https://"), link:i.infoLink || ""};
    });
    renderSearchResults(items);
    $("searchStatus").textContent = items.length ? `${items.length}개의 도서 정보를 찾았습니다. 검색 결과는 서지정보이며 원문 전체를 의미하지 않습니다.` : "검색 결과가 없습니다.";
  } catch (err) {
    $("searchStatus").textContent = "Google Books 검색에 실패했습니다. 잠시 후 다시 시도하세요.";
  }
}
function renderSearchResults(items) {
  $("searchResults").innerHTML = "";
  items.forEach(book => {
    const row = document.createElement("div"); row.className = "book-result";
    const img = document.createElement("img"); img.src = book.thumbnail || "https://placehold.co/48x68?text=Book"; img.alt = "책 표지";
    const meta = document.createElement("div"); meta.className = "book-meta";
    const title = document.createElement("strong"); title.textContent = book.title;
    const detail = document.createElement("small"); detail.textContent = `${book.authors.join(", ") || "저자 정보 없음"} · ${book.publisher}`;
    meta.append(title, detail);
    const btn = document.createElement("button"); btn.className = "secondary"; btn.textContent = "선택";
    btn.onclick = () => { setSelectedBook(book); $("searchStatus").textContent = "책 정보를 선택했습니다. 원문 파일도 업로드해야 전문 분석을 진행할 수 있습니다."; };
    row.append(img, meta, btn); $("searchResults").append(row);
  });
}

async function extractFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  $("fileStatus").textContent = `${file.name} 파일을 읽고 있습니다…`;
  let text = "";
  if (ext === "txt") {
    text = await file.text();
  } else if (ext === "pdf") {
    if (!pdfjsLibRef) throw new Error("PDF 처리 모듈을 불러오지 못했습니다. 새로고침 후 다시 시도하세요.");
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLibRef.getDocument({data}).promise;
    const pages = [];
    for (let p=1; p<=pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      pages.push(`\n\n[페이지 ${p}]\n` + content.items.map(x=>x.str).join(" "));
    }
    text = pages.join("");
  } else if (ext === "epub") {
    if (!window.ePub) throw new Error("EPUB 처리 모듈을 불러오지 못했습니다.");
    const book = ePub(await file.arrayBuffer());
    await book.ready;
    const sections = book.spine.spineItems || [];
    const parts = [];
    for (const section of sections) {
      try {
        const doc = await section.load(book.load.bind(book));
        parts.push(doc.body?.textContent || doc.documentElement?.textContent || "");
        section.unload();
      } catch(e) { console.warn("EPUB section skipped", e); }
    }
    text = parts.join("\n\n");
    book.destroy();
  } else {
    throw new Error("지원하지 않는 파일입니다. PDF, EPUB, TXT 파일을 선택하세요.");
  }
  text = text.replace(/\s{3,}/g, " ").trim();
  if (text.length < 300) throw new Error("텍스트를 충분히 추출하지 못했습니다. 스캔 PDF라면 OCR 처리된 파일을 사용하세요.");
  extractedText = text;
  const titleFromName = file.name.replace(/\.[^.]+$/, "");
  if (!$("titleInput").value.trim()) $("titleInput").value = titleFromName;
  $("fileStatus").textContent = `${file.name} · ${text.length.toLocaleString()}자 추출 완료`;
  setSource(`원문 텍스트 ${text.length.toLocaleString()}자 확보. 현재 1차 버전은 분석 가능한 분량을 제한하며, 원문 전체 확보 여부를 분석 결과에 표시합니다.`);
  enableAnalysis();
}

$("searchBtn").addEventListener("click", searchBooks);
$("bookSearch").addEventListener("keydown", e => { if(e.key==="Enter") searchBooks(); });
$("fileInput").addEventListener("change", async e => {
  const file = e.target.files?.[0]; if(!file) return;
  try { await extractFile(file); } catch(err) { $("fileStatus").textContent = err.message; extractedText=""; enableAnalysis(); }
});
["titleInput","authorInput"].forEach(id => $(id).addEventListener("input", enableAnalysis));

async function analyze() {
  if (!API_BASE.startsWith("https://") || API_BASE.includes("YOUR-WORKER")) {
    alert("먼저 frontend/app.js의 API_BASE를 배포한 Cloudflare Worker 주소로 변경하세요."); return;
  }
  const title = $("titleInput").value.trim();
  const author = $("authorInput").value.trim();
  const category = $("categoryInput").value;
  if (!extractedText || !title) return;
  $("analyzeBtn").disabled = true;
  $("progressPanel").classList.remove("hidden");
  $("resultPanel").classList.add("hidden");
  $("progressBar").style.width = "45%";
  $("progressText").textContent = "원문을 분석하고 핵심 논리와 개념을 정리하고 있습니다.";
  try {
    const response = await fetch(`${API_BASE}/api/analyze`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({title,author,category,text:extractedText.slice(0,50000),originalLength:extractedText.length})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `분석 요청 실패 (${response.status})`);
    currentAnalysis = data.analysis || "";
    currentBook = {title, authors: author ? [author] : [], category};
    $("resultTitle").textContent = title;
    renderPlainText(currentAnalysis);
    $("analysisMeta").textContent = `전달된 텍스트 ${Math.min(extractedText.length,50000).toLocaleString()}자 / 추출된 전체 ${extractedText.length.toLocaleString()}자 · ${data.model || "AI 모델"} · 원문 전체 분석 여부는 자료 범위를 확인하세요.`;
    $("progressBar").style.width = "100%";
    $("progressText").textContent = "분석이 완료되었습니다.";
    $("resultPanel").classList.remove("hidden");
    $("resultPanel").scrollIntoView({behavior:"smooth"});
    const mind = data.mindmap || "";
    $("mindmap").textContent = mind;
    if (mind && window.mermaid) {
      try { await mermaid.run({nodes:[$("mindmap")]}); } catch(e) { $("mindmap").textContent = "마인드맵 렌더링에 실패했습니다.\n" + mind; }
    }
  } catch(err) {
    alert(err.message);
    $("progressText").textContent = "분석에 실패했습니다.";
  } finally { $("analyzeBtn").disabled = false; }
}
$("analyzeBtn").addEventListener("click", analyze);

$("speakBtn").addEventListener("click", () => {
  if (!currentAnalysis) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(currentAnalysis.slice(0,12000));
  utterance.lang = "ko-KR"; utterance.rate = 1;
  speechSynthesis.speak(utterance);
});
$("stopSpeakBtn").addEventListener("click", () => speechSynthesis.cancel());
$("mindmapBtn").addEventListener("click", () => $("mindmapWrap").classList.toggle("hidden"));

function getLibrary() { try { return JSON.parse(localStorage.getItem("bookInsightLibrary") || "[]"); } catch { return []; } }
function drawLibrary() {
  const list = getLibrary(); const root = $("libraryList"); root.innerHTML = "";
  if (!list.length) { root.innerHTML = '<p class="hint">저장한 분석 결과가 여기에 표시됩니다.</p>'; return; }
  list.forEach((item, idx) => {
    const row = document.createElement("div"); row.className = "library-item";
    const meta = document.createElement("div"); const title = document.createElement("strong"); title.textContent = item.title;
    const date = document.createElement("small"); date.textContent = item.date;
    meta.append(title,date);
    const open = document.createElement("button"); open.className="secondary"; open.textContent="열기";
    open.onclick = () => { currentAnalysis=item.analysis; $("resultTitle").textContent=item.title; renderPlainText(item.analysis); $("resultPanel").classList.remove("hidden"); $("resultPanel").scrollIntoView({behavior:"smooth"}); };
    row.append(meta,open); root.append(row);
  });
}
$("saveBtn").addEventListener("click", () => {
  if (!currentAnalysis || !currentBook) return;
  const list = getLibrary().filter(x=>x.title!==currentBook.title);
  list.unshift({title:currentBook.title,analysis:currentAnalysis,date:new Date().toLocaleDateString("ko-KR")});
  try { localStorage.setItem("bookInsightLibrary",JSON.stringify(list.slice(0,30))); drawLibrary(); alert("내 서재에 저장했습니다."); }
  catch { alert("저장 공간이 부족합니다. 기존 기록을 정리해 주세요."); }
});
$("clearLibraryBtn").addEventListener("click", () => { if(confirm("저장한 독서 기록을 모두 삭제할까요?")) {localStorage.removeItem("bookInsightLibrary");drawLibrary();} });
drawLibrary();


// Android Chrome 설치 프롬프트: 지원되는 브라우저에서만 버튼을 표시합니다.
let deferredInstallPrompt = null;
const installButton = document.getElementById("installBtn");
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton?.classList.remove("hidden");
});
installButton?.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.classList.add("hidden");
});
window.addEventListener("appinstalled", () => installButton?.classList.add("hidden"));
