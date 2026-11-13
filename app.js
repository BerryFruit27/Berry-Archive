// Keeps the app code in its own scope so its variables do not conflict with other scripts.
(() => {
  "use strict";
  // Database name and version. These identify the browser storage used for your stories.
  const DB_NAME = "little-archive-db";
  const DB_VERSION = 1;
  // Variables that remember the current database, open story, chapter, and form draft.
  let db;
  let currentFicId = null;
  let currentChapterIndex = 0;
  let draftChapters = [];
  let toastTimer;
  // Shortcut: $("titleInput") finds the HTML element whose id is "titleInput".
  const $ = id => document.getElementById(id);
  // Shared library settings: saved stories, search text, selected filter, and sort order.
  const state = { fics: [], query: "", status: "all", sort: "added" };

  // Opens the browser database. Stories are kept on this device for offline use.
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains("fics")) {
          const store = database.createObjectStore("fics", { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  // Gets the stories storage area. Use "readwrite" when changing saved data.
  function store(mode = "readonly") { return db.transaction("fics", mode).objectStore("fics"); }
  // Loads every saved story from the browser database.
  function getAll() {
    return new Promise((resolve, reject) => {
      const req = store().getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  // Saves a new story or updates an existing story.
  function saveFic(fic) {
    return new Promise((resolve, reject) => {
      const req = store("readwrite").put(fic);
      req.onsuccess = () => resolve(fic);
      req.onerror = () => reject(req.error);
    });
  }
  // Deletes a story by its unique ID.
  function deleteFic(id) {
    return new Promise((resolve, reject) => {
      const req = store("readwrite").delete(id);
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    });
  }
  // Creates a unique ID so each story and chapter can be identified.
  function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  // Escapes special characters before inserting user-provided text into HTML.
  function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
  }
  // Removes unsafe HTML elements and attributes before story content is displayed.
  function cleanHTML(input) {
    const doc = new DOMParser().parseFromString(String(input || ""), "text/html");
    doc.querySelectorAll("script, iframe, frame, frameset, object, embed, applet, form, input, button, textarea, select, meta[http-equiv], base, link[rel=import]").forEach(el => el.remove());
    doc.querySelectorAll("*").forEach(el => {
      [...el.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        if (name.startsWith("on") || name === "srcdoc" || ((name === "href" || name === "src" || name === "xlink:href" || name === "action") && value.startsWith("javascript:"))) el.removeAttribute(attr.name);
      });
      if (el.tagName === "A") {
        const href = el.getAttribute("href") || "";
        if (/^\s*(javascript|data):/i.test(href)) el.removeAttribute("href");
        el.setAttribute("rel", "noopener noreferrer");
      }
    });
    return doc.body.innerHTML || `<p>${escapeHTML(doc.body.textContent || "")}</p>`;
  }
  // Converts HTML into plain text, which is useful for searching and counting words.
  function plainText(input) {
    const doc = new DOMParser().parseFromString(String(input || ""), "text/html");
    return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
  }
  // Counts the words in a chapter or story.
  function wordCount(html) {
    const text = plainText(html);
    return text ? text.split(/\s+/).filter(Boolean).length : 0;
  }
  // Formats numbers using Canadian English conventions.
  function formatNumber(n) { return Number(n || 0).toLocaleString("en-CA"); }
  // Turns a saved timestamp into a readable date.
  function dateLabel(timestamp) {
    if (!timestamp) return "Just added";
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "short", day: "numeric" }).format(new Date(timestamp));
  }
  // Shows a short status message at the bottom of the page.
  function toast(message) {
    $("toast").textContent = message;
    $("toast").classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2600);
  }
  // Works out whether a story is unread, in progress, or finished.
  function currentStatus(fic) {
    if (fic.read) return "read";
    if (fic.lastOpenedAt) return "reading";
    return "unread";
  }
  // Returns the readable label for a story’s reading status.
  function statusText(fic) {
    return ({ unread: "Unread", reading: "In progress", read: "Finished" })[currentStatus(fic)];
  }




  // Applies the current search, status filter, and sort order to the story list.
  function visibleFics() {
    let list = [...state.fics];
    const q = state.query.trim().toLocaleLowerCase("en-CA");
    if (q) list = list.filter(f => [f.title, f.author, f.fandom, f.summary, ...(f.tags || [])].join(" ").toLocaleLowerCase("en-CA").includes(q));




    // Gets the included tags and ignores capitalisation.
const includeTags = $("includeTagsInput").value
  .split(",")
  .map(tag => tag.trim().toLowerCase())
  .filter(Boolean);

// Gets the excluded tags and ignores capitalisation.
const excludeTags = $("excludeTagsInput").value
  .split(",")
  .map(tag => tag.trim().toLowerCase())
  .filter(Boolean);

// Filters stories by included tags.
if (includeTags.length) {
  const matchMode = $("tagMatchMode").value;

  list = list.filter(fic => {
    const ficTags = (fic.tags || []).map(tag => tag.toLowerCase());

    if (matchMode === "all") {
      return includeTags.every(tag => ficTags.includes(tag));
    }

    return includeTags.some(tag => ficTags.includes(tag));
  });
}

// Hides stories containing excluded tags.
if (excludeTags.length) {
  list = list.filter(fic => {
    const ficTags = (fic.tags || []).map(tag => tag.toLowerCase());

    return !excludeTags.some(tag => ficTags.includes(tag));
  });
}





    

    const keyword = $("keywordSearchInput").value.trim().toLocaleLowerCase("en-CA");

if (keyword) {
  list = list.filter(f =>
    [f.title, f.summary, ...(f.tags || [])]
      .join(" ")
      .toLocaleLowerCase("en-CA")
      .includes(keyword)
  );
}



    
    const selectedRelationship = $("relationshipFilter").value.toLocaleLowerCase("en-CA");

if (selectedRelationship) {
  list = list.filter(f =>
    (f.relationships || []).some(relationship =>
      relationship.toLocaleLowerCase("en-CA") === selectedRelationship
    )
  );
}
    
    
    if (state.status === "bookmarked") list = list.filter(f => f.bookmarked);
    else if (state.status !== "all") list = list.filter(f => currentStatus(f) === state.status);
    const sorters = {
      added: (a,b) => b.createdAt - a.createdAt,
      updated: (a,b) => b.updatedAt - a.updatedAt,
      title: (a,b) => a.title.localeCompare(b.title, "en-CA"),
      author: (a,b) => (a.author || "").localeCompare(b.author || "", "en-CA"),
      words: (a,b) => (b.words || wordCount(b.content)) - (a.words || wordCount(a.content))
    };
    return list.sort(sorters[state.sort] || sorters.added);
  }




  // Draws the story cards and empty-state message on the bookshelf.

  const expandedCards = new Set();
  function renderLibrary() {
  const relationshipFilter = $("relationshipFilter");
  const selectedRelationship = relationshipFilter.value;

  const relationships = [
    ...new Set(
      state.fics.flatMap(f => f.relationships || [])
    )
  ].sort((a, b) => a.localeCompare(b, "en-CA"));

  relationshipFilter.innerHTML =
    '<option value="">All relationships</option>' +
    relationships.map(relationship =>
      `<option value="${escapeHTML(relationship)}">${escapeHTML(relationship)}</option>`
    ).join("");

  if (relationships.includes(selectedRelationship)) {
  relationshipFilter.value = selectedRelationship;
}

const list = visibleFics();

$("libraryCount").textContent =
  `${list.length} ${list.length === 1 ? "story" : "stories"}`;
    $("ficGrid").innerHTML = list.map(f => {
      const expanded = expandedCards.has(f.id);

const tags = (expanded ? (f.tags || []) : (f.tags || []).slice(0, 3)).map(t =>
  `<span class="tag" data-filter-tag="${escapeHTML(t)}">${escapeHTML(t)}</span>`
).join("");

const summary = f.summary
  ? `<p class="card-summary" ${expanded ? 'style="display:block;overflow:visible;max-height:none;-webkit-line-clamp:unset;"' : ""}>${escapeHTML(f.summary)}</p>`
  : "";
     // Automatically counts words across all chapters.
const chapters = normaliseChapters(f);

const words = chapters.reduce((total, chapter) => {
  return total + wordCount(chapter.content);
}, 0);

const chapterCount = chapters.length;
      return `<article class="fic-card" tabindex="0" role="button" data-open="${escapeHTML(f.id)}" aria-label="Read ${escapeHTML(f.title)}">
        
      
      
      
      
      
      
      
      
      
      
      <div class="card-top">
  <span class="card-fandom">${escapeHTML(f.fandom || "Uncategorised")}</span>

  <div class="card-actions">
    <button
      class="card-delete"
      data-delete="${escapeHTML(f.id)}"
      aria-label="Delete ${escapeHTML(f.title)}"
      title="Delete fic"
      type="button"
    > ☠︎︎</button>

    <button
      class="card-bookmark"
      data-bookmark="${escapeHTML(f.id)}"
      aria-label="${f.bookmarked ? "Remove bookmark" : "Bookmark"}"
      title="${f.bookmarked ? "Remove bookmark" : "Bookmark"}"
      type="button"
    >${f.bookmarked ? "♥" : "♡"}</button>
  </div>
</div>





        <h3>${escapeHTML(f.title)}</h3><p class="card-author">${f.author ? "by " + escapeHTML(f.author) : "Author unknown"}</p>
       ${summary}
<div class="tag-list">${tags}</div>

<button class="expand-card-btn" data-expand="${escapeHTML(f.id)}" type="button">
  ${expanded ? "Show less ▲" : "Show more ▼"}
</button>
        <div class="card-bottom"><span>${formatNumber(words)} words · ${chapterCount} ${chapterCount === 1 ? "chapter" : "chapters"} · ${dateLabel(f.createdAt)}</span><span class="status-pill ${f.read ? "read" : ""}">${statusText(f)}</span></div>
      </article>`;
    }).join("");
    const empty = list.length === 0;
    $("emptyState").classList.toggle("show", empty);
    $("ficGrid").classList.toggle("hidden", empty);
    if (empty && state.fics.length) {
      $("emptyState").querySelector("h3").textContent = "No stories found.";
      $("emptyState").querySelector("p").textContent = "Try another search or clear your filters to see your whole collection.";
      $("emptyState").querySelector("button").classList.add("hidden");
    } else {      $("emptyState").querySelector("h3").textContent = "Your shelf is waiting.";
      $("emptyState").querySelector("p").textContent = "Add a fic by pasting its HTML or importing a file from your device.";
      $("emptyState").querySelector("button").classList.remove("hidden");
    }
  }
  // Returns to the bookshelf view.
  function showLibrary() {
    $("libraryView").classList.remove("hidden");
    $("readerView").classList.add("hidden");
    currentFicId = null;
    renderLibrary();
    window.scrollTo(0, 0);
  }
  // Opens a selected story and fills the reader with its details and current chapter.
  async function openReader(id) {
    const fic = state.fics.find(f => f.id === id);
    if (!fic) return;
    currentFicId = id;
    fic.lastOpenedAt = Date.now();
    fic.updatedAt = fic.updatedAt || Date.now();
    await saveFic(fic);
    $("readerFandom").textContent = fic.fandom || "A story from your collection";
    $("readerTitle").textContent = fic.title;
    $("readerAuthor").textContent = fic.author ? `by ${fic.author}` : "Author unknown";
    $("readerBadges").innerHTML = `<span class="badge">${escapeHTML(fic.rating || "Not rated")}</span>${fic.read ? '<span class="badge">Finished</span>' : ""}`;
    const chapters = normaliseChapters(fic);
    const totalWords = fic.words || chapters.reduce((sum, ch) => sum + wordCount(ch.content), 0);
    $("readerStats").textContent = `${formatNumber(totalWords)} words · ${chapters.length} ${chapters.length === 1 ? "chapter" : "chapters"} · Added ${dateLabel(fic.createdAt)}`;
    $("readerSummary").textContent = fic.summary || "";
    $("readerSummary").classList.toggle("hidden", !fic.summary);
    $("readerTags").innerHTML = (fic.tags || []).map(t => `<span class="tag">${escapeHTML(t)}</span>`).join("");
    currentChapterIndex = Math.min(currentChapterIndex, chapters.length - 1);
    setChapter(currentChapterIndex, false);
    $("readerBookmarkBtn").textContent = fic.bookmarked ? "♥" : "♡";
    $("readerBookmarkBtn").setAttribute("aria-label", fic.bookmarked ? "Remove bookmark" : "Bookmark");
    $("readStatusLabel").textContent = statusText(fic);
    $("toggleReadBtn").textContent = fic.read ? "Mark as unread ↺" : "Mark as finished ✓";
    $("libraryView").classList.add("hidden");
    $("readerView").classList.remove("hidden");
    renderLibrary();
    window.scrollTo(0, 0);
  }
  // Makes sure every story has a chapter list, including older single-chapter stories.
  function normaliseChapters(fic) {
    if (Array.isArray(fic?.chapters) && fic.chapters.length) {
      return fic.chapters.map((ch, i) => ({
        id: ch.id || uid(),
        title: String(ch.title || `Chapter ${i + 1}`),
        content: String(ch.content || "")
      }));
    }
    return [{ id: uid(), title: "Chapter 1", content: String(fic?.content || "") }];
  }
  // Builds the chapter editing fields in the Add/Edit Story window.
  function renderChapterEditor() {
    const host = $("chapterEditorList");
    host.innerHTML = draftChapters.map((ch, i) => `
      <section class="chapter-edit-card" data-chapter-card="${i}">
        <div class="chapter-edit-header">
          <span class="chapter-number">CH. ${i + 1}</span>
          <input data-chapter-title="${i}" aria-label="Chapter ${i + 1} title" maxlength="240" value="${escapeHTML(ch.title)}" placeholder="Chapter title">
          <div class="chapter-edit-reorder">
            <button type="button" data-move-chapter="${i}" data-direction="-1" ${i === 0 ? "disabled" : ""} aria-label="Move chapter up">↑</button>
            <button type="button" data-move-chapter="${i}" data-direction="1" ${i === draftChapters.length - 1 ? "disabled" : ""} aria-label="Move chapter down">↓</button>
            <button type="button" data-delete-chapter="${i}" aria-label="Delete chapter" title="Delete chapter">×</button>
          </div>
        </div>
        <textarea data-chapter-content="${i}" rows="7" aria-label="Chapter ${i + 1} HTML or text" placeholder="<p>Chapter content…</p>">${escapeHTML(ch.content)}</textarea>
      </section>`).join("");
  }
  // Copies the current chapter titles and text from the form into the draft.
  function readChapterEditor() {
    $("chapterEditorList").querySelectorAll("[data-chapter-title]").forEach(input => {
      const i = Number(input.dataset.chapterTitle);
      if (draftChapters[i]) draftChapters[i].title = input.value;
    });
    $("chapterEditorList").querySelectorAll("[data-chapter-content]").forEach(input => {
      const i = Number(input.dataset.chapterContent);
      if (draftChapters[i]) draftChapters[i].content = input.value;
    });
  }
  // Displays one chapter and updates the chapter picker and Previous/Next buttons.
  function setChapter(index, scroll = true) {
    const fic = state.fics.find(f => f.id === currentFicId);
    if (!fic) return;
    const chapters = normaliseChapters(fic);
    currentChapterIndex = Math.max(0, Math.min(index, chapters.length - 1));
    const chapter = chapters[currentChapterIndex];
    $("ficContent").innerHTML = cleanHTML(chapter.content || "<p><em>This chapter has no content yet.</em></p>");
    $("chapterNavigation").classList.toggle("hidden", chapters.length <= 1);
    $("bottomChapterNavigation").classList.toggle("hidden", chapters.length <= 1);
    $("chapterPicker").innerHTML = chapters.map((ch, i) => `<option value="${i}">${i + 1}. ${escapeHTML(ch.title || `Chapter ${i + 1}`)}</option>`).join("");
    $("chapterPicker").value = String(currentChapterIndex);
    $("chapterPosition").textContent = `${currentChapterIndex + 1} of ${chapters.length}`;
    $("prevChapterBtn").disabled = currentChapterIndex === 0;
    $("prevChapterBottomBtn").disabled = currentChapterIndex === 0;
    $("nextChapterBtn").disabled = currentChapterIndex === chapters.length - 1;
    $("nextChapterBottomBtn").disabled = currentChapterIndex === chapters.length - 1;
    if (scroll) window.scrollTo(0, 0);
  }

  // Opens the Add/Edit Story window and fills it with either blank or existing details.
  function openDialog(fic = null) {
    $("ficForm").reset();
    $("ficId").value = fic ? fic.id : "";
    $("dialogTitle").textContent = fic ? "Edit your fic" : "Add a fic";
    $("titleInput").value = fic?.title || "";
    $("authorInput").value = fic?.author || "";
    $("fandomInput").value = fic?.fandom || "";
    $("ratingInput").value = fic?.rating || "Not rated";
    $("wordsInput").value = fic?.words || "";

    $("tagsInput").value = (fic?.tags || []).join(", ");

    $("relationshipsInput").value = (fic?.relationships || []).join(", ");

    $("summaryInput").value = fic?.summary || "";
    draftChapters = normaliseChapters(fic);
    // Keep older single-content entries compatible while migrating them to a chapter.
    renderChapterEditor();
    $("fileName").textContent = "";
    $("ficDialog").showModal();
    setTimeout(() => $("titleInput").focus(), 30);
  }
  // Closes the Add/Edit Story window.
  function closeDialog() { $("ficDialog").close(); }



// Suggests existing tags or relationships as you type.
function setupSuggestions(inputId, suggestionsId, propertyName) {
  const input = $(inputId);
  const suggestions = $(suggestionsId);

  function updateSuggestions() {
    const typed = input.value.split(",").pop().trim().toLowerCase();

    suggestions.replaceChildren();
    suggestions.hidden = true;

    if (!typed) return;

    // Collect existing values without case-sensitive duplicates.
    const existing = [
      ...new Map(
        state.fics
          .flatMap(fic => fic[propertyName] || [])
          .map(value => [value.toLowerCase(), value])
      ).values()
    ];

    const matches = existing
      .filter(value => value.toLowerCase().includes(typed))
      .sort((a, b) => a.localeCompare(b, "en-CA"))
      .slice(0, 8);

    matches.forEach(value => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "autocomplete-option";
      option.textContent = value;

      option.addEventListener("click", () => {
        const parts = input.value.split(",");
        parts[parts.length - 1] = " " + value;

        input.value = parts.join(",").trim() + ", ";
        suggestions.hidden = true;
        input.focus();
      });

      suggestions.appendChild(option);
    });

    suggestions.hidden = matches.length === 0;
  }

  input.addEventListener("input", updateSuggestions);

  input.addEventListener("blur", () => {
    setTimeout(() => {
      suggestions.hidden = true;
    }, 150);
  });
}

// Enable dropdowns for tags and ships.
setupSuggestions("tagsInput", "tagSuggestions", "tags");
setupSuggestions("relationshipsInput", "relationshipSuggestions", "relationships");



  
// Splits tags at commas and removes duplicates regardless of capitalisation.
function parseTags(value) {
  const tags = value.split(",").map(t => t.trim()).filter(Boolean);

  return tags.filter((tag, index) =>
    tags.findIndex(t => t.toLowerCase() === tag.toLowerCase()) === index
  ).slice(0, 80);
}
  // Reloads saved stories and redraws the bookshelf after a change.
  async function refresh() { state.fics = await getAll(); renderLibrary(); }
  // Adds or removes a bookmark and saves the change.
  async function toggleBookmark(id) {
    const fic = state.fics.find(f => f.id === id);
    if (!fic) return;
    fic.bookmarked = !fic.bookmarked;
    fic.updatedAt = Date.now();
    await saveFic(fic);
    await refresh();
    if (currentFicId === id) $("readerBookmarkBtn").textContent = fic.bookmarked ? "♥" : "♡";
  }
  // Downloads a JSON backup containing all stories and their chapters.
  async function exportBackup() {
    const data = { app: "Berry’s Archive", version: 1, exportedAt: new Date().toISOString(), fics: await getAll() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `berrys-archive-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(url);
    toast("Backup exported. Keep it somewhere safe.");
  }
  // Reads a JSON backup file and restores its stories into this browser.
  async function importBackup(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.fics)) throw new Error("That file does not look like a Berry’s Archive backup.");
      if (!confirm(`Import ${data.fics.length} stories? Stories with matching IDs will be replaced. Export a backup first if you want a safety copy.`)) return;
      for (const raw of data.fics) {        if (!raw || !raw.title) continue;
        const importedChapters = Array.isArray(raw.chapters) && raw.chapters.length
          ? raw.chapters.map((ch, i) => ({ id: ch.id || uid(), title: String(ch.title || `Chapter ${i + 1}`), content: cleanHTML(ch.content || "") }))
          : [{ id: uid(), title: "Chapter 1", content: cleanHTML(raw.content || "") }];
        await saveFic({ ...raw, id: raw.id || uid(), title: String(raw.title), chapters: importedChapters, content: importedChapters.map(ch => ch.content).join("\\n"), tags: Array.isArray(raw.tags) ? raw.tags : [], updatedAt: Date.now() });
      }
      await refresh(); toast("Backup imported.");
    } catch (err) { toast(err.message || "Could not import that backup."); }
    $("backupInput").value = "";
  }
  // Connects the page buttons and inputs to their actions.
  $("addBtn").addEventListener("click", () => openDialog());
  $("emptyAddBtn").addEventListener("click", () => openDialog());
  $("homeBtn").addEventListener("click", showLibrary);
  $("backBtn").addEventListener("click", showLibrary);
  $("readerBackBottom").addEventListener("click", showLibrary);
  $("closeDialogBtn").addEventListener("click", closeDialog);
  $("cancelDialogBtn").addEventListener("click", closeDialog);
  $("ficDialog").addEventListener("click", e => { if (e.target === $("ficDialog")) closeDialog(); });
  $("searchInput").addEventListener("input", e => { state.query = e.target.value; renderLibrary(); });
  $("keywordSearchInput").addEventListener("input", renderLibrary);
  // Updates the library when tag filters change.
  $("includeTagsInput").addEventListener("input", renderLibrary);
  $("excludeTagsInput").addEventListener("input", renderLibrary);
  $("tagMatchMode").addEventListener("change", renderLibrary);
  


  
  $("statusFilter").addEventListener("change", e => { state.status = e.target.value; renderLibrary(); });

  $("relationshipFilter").addEventListener("change", renderLibrary);

  $("sortSelect").addEventListener("change", e => { state.sort = e.target.value; renderLibrary(); });
  $("clearFiltersBtn").addEventListener("click", () => {
  state.query = "";
  state.status = "all";
  state.sort = "added";

  $("searchInput").value = "";
  $("keywordSearchInput").value = "";
  $("includeTagsInput").value = "";
  $("excludeTagsInput").value = "";
  $("tagMatchMode").value = "any";
  $("statusFilter").value = "all";
  $("sortSelect").value = "added";
  $("relationshipFilter").value = "";

  renderLibrary();
});


 
$("ficGrid").addEventListener("click", async e => {

  const expandButton = e.target.closest("[data-expand]");

if (expandButton) {
  e.stopPropagation();

  const ficId = expandButton.dataset.expand;

  if (expandedCards.has(ficId)) {
    expandedCards.delete(ficId);
  } else {
    expandedCards.add(ficId);
  }

  renderLibrary();
  return;
}

   // Clicking a tag filters the bookshelf by that tag.
  const clickedTag = e.target.closest("[data-filter-tag]");

  if (clickedTag) {
    e.stopPropagation();

    $("includeTagsInput").value = clickedTag.dataset.filterTag;
    $("tagMatchMode").value = "any";

    renderLibrary();
    return;
  }
  // Handle the Delete Fic button first.
  const deleteButton = e.target.closest("[data-delete]");

  if (deleteButton) {
    e.stopPropagation();

    const ficId = deleteButton.dataset.delete;
    const fic = state.fics.find(f => f.id === ficId);

    // Stop if the story can't be found.
    if (!fic) return;

    // Ask for confirmation before permanently deleting the fic.
    const confirmed = confirm(
      `Are you sure you want to delete "${fic.title}"?\n\n` +
      "This will permanently delete the fic and its chapters. " +
      "This action cannot be undone."
    );

    // Do nothing if the user presses Cancel.
    if (!confirmed) return;

    try {
      await deleteFic(ficId);
      await refresh();
      toast("Fic deleted successfully.");
    } catch (err) {
      toast("Could not delete this fic. Please try again.");
      console.error("Error deleting fic:", err);
    }

    return;
  }

  // Keep the existing bookmark feature working.
  const bookmark = e.target.closest("[data-bookmark]");

  if (bookmark) {
    e.stopPropagation();
    await toggleBookmark(bookmark.dataset.bookmark);
    return;
  }

  // Open the fic when the rest of its card is clicked.
  const card = e.target.closest("[data-open]");

  if (card) await openReader(card.dataset.open);
});






  $("ficGrid").addEventListener("keydown", async e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-open]")) { e.preventDefault(); await openReader(e.target.dataset.open); }
  });
  $("readerBookmarkBtn").addEventListener("click", async () => { if (currentFicId) await toggleBookmark(currentFicId); });
  $("editFicBtn").addEventListener("click", () => { const fic = state.fics.find(f => f.id === currentFicId); if (fic) openDialog(fic); });
  $("toggleReadBtn").addEventListener("click", async () => {
    const fic = state.fics.find(f => f.id === currentFicId); if (!fic) return;
    fic.read = !fic.read; fic.updatedAt = Date.now(); await saveFic(fic); await refresh(); await openReader(fic.id);
  });
  // Imports a selected HTML or text file into the first chapter.
  $("ficFileInput").addEventListener("change", async e => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const text = await file.text();
      readChapterEditor();
      const content = file.name.toLowerCase().endsWith(".txt") ? `<p>${escapeHTML(text).replace(/\r?\n/g, "<br>")}</p>` : cleanHTML(text);
      if (!draftChapters.length) draftChapters = [{ id: uid(), title: "Chapter 1", content }];
      else draftChapters[0].content = content;
      if (!draftChapters[0].title || draftChapters[0].title === "Chapter 1") draftChapters[0].title = "Chapter 1";
      renderChapterEditor();
      $("fileName").textContent = `Loaded: ${file.name} (${formatNumber(file.size)} bytes) into Chapter 1`;
      if (!$("titleInput").value) $("titleInput").value = file.name.replace(/\.(html?|xhtml|txt)$/i, "").replace(/[_-]+/g, " ");
      toast("File loaded into Chapter 1. Save the fic to keep it in your library.");
    } catch { toast("Sorry, that file could not be read."); }
    e.target.value = "";
  });
  // Adds a blank chapter to the current story draft.
  $("addChapterBtn").addEventListener("click", () => {
    readChapterEditor();
    draftChapters.push({ id: uid(), title: `Chapter ${draftChapters.length + 1}`, content: "" });
    renderChapterEditor();
    const inputs = $("chapterEditorList").querySelectorAll("[data-chapter-title]");
    inputs[inputs.length - 1]?.focus();
  });
  // Keeps the chapter draft updated while titles or content are edited.
  $("chapterEditorList").addEventListener("input", e => {
    if (e.target.matches("[data-chapter-title]")) {
      const i = Number(e.target.dataset.chapterTitle);
      if (draftChapters[i]) draftChapters[i].title = e.target.value;
    } else if (e.target.matches("[data-chapter-content]")) {
      const i = Number(e.target.dataset.chapterContent);
      if (draftChapters[i]) draftChapters[i].content = e.target.value;
    }
  });
  // Handles moving chapters up/down and deleting chapters.
  $("chapterEditorList").addEventListener("click", e => {
    const del = e.target.closest("[data-delete-chapter]");
    const move = e.target.closest("[data-move-chapter]");
    if (!del && !move) return;
    readChapterEditor();
    if (del) {
      const i = Number(del.dataset.deleteChapter);
      if (draftChapters.length === 1) { toast("A fic needs at least one chapter."); return; }
      if (!confirm(`Delete Chapter ${i + 1}? This chapter's content will be removed when you save.`)) return;
      draftChapters.splice(i, 1);
    } else {
      const i = Number(move.dataset.moveChapter);
      const j = i + Number(move.dataset.direction);
      if (j < 0 || j >= draftChapters.length) return;
      [draftChapters[i], draftChapters[j]] = [draftChapters[j], draftChapters[i]];
    }
    renderChapterEditor();
  });
  $("chapterPicker").addEventListener("change", e => setChapter(Number(e.target.value)));
  $("prevChapterBtn").addEventListener("click", () => setChapter(currentChapterIndex - 1));
  $("nextChapterBtn").addEventListener("click", () => setChapter(currentChapterIndex + 1));
  $("prevChapterBottomBtn").addEventListener("click", () => setChapter(currentChapterIndex - 1));
  $("nextChapterBottomBtn").addEventListener("click", () => setChapter(currentChapterIndex + 1));

  // Saves the story details and chapter content when the form is submitted.
  $("ficForm").addEventListener("submit", async e => {
    e.preventDefault();
    const id = $("ficId").value || uid();
    const existing = state.fics.find(f => f.id === id);
    readChapterEditor();
    const chapters = draftChapters.map((ch, i) => ({
      id: ch.id || uid(),
      title: (ch.title || "").trim() || `Chapter ${i + 1}`,
      content: cleanHTML(ch.content || "")
    }));
    const totalWords = chapters.reduce((sum, ch) => sum + wordCount(ch.content), 0);
    const now = Date.now();
    const fic = {
      id, title: $("titleInput").value.trim(), author: $("authorInput").value.trim(),
      fandom: $("fandomInput").value.trim(), rating: $("ratingInput").value,
      words: Math.max(0, Number.parseInt($("wordsInput").value, 10) || totalWords),



      tags: parseTags($("tagsInput").value),
relationships: parseTags($("relationshipsInput").value),
summary: $("summaryInput").value.trim(),
chapters,



      // Retain a combined legacy field so older backups / app versions can still read the story.
      content: chapters.map(ch => ch.content).join("\\n"),
      createdAt: existing?.createdAt || now, updatedAt: now, lastOpenedAt: existing?.lastOpenedAt || null,
      read: existing?.read || false, bookmarked: existing?.bookmarked || false
    };
    try {
      await saveFic(fic); await refresh(); closeDialog();
      if (currentFicId === id) await openReader(id); else showLibrary();
      toast(existing ? "Your changes have been saved." : "Fic added to your library.");
    } catch { toast("Could not save this fic. Check available storage on your device."); }
  });
  // Connects the backup buttons to export and import functions.
  $("backupBtn").addEventListener("click", exportBackup);
  $("backupInput").addEventListener("change", e => { if (e.target.files?.[0]) importBackup(e.target.files[0]); });
  // Starts the app: open local storage, load stories, and show the bookshelf.
  (async () => {
    try {
      if (!("indexedDB" in window)) throw new Error("This browser does not support local offline storage.");
      db = await openDB();
      await refresh();
    } catch (err) {
      $("emptyState").classList.add("show");
      $("emptyState").querySelector("h3").textContent = "Your library could not start.";
      $("emptyState").querySelector("p").textContent = `${err.message || "Browser storage is unavailable."} Try opening this folder in a current version of Firefox, Chrome, or Edge.`;
      $("emptyState").querySelector("button").classList.add("hidden");
    }
  })();
})();
