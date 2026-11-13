
(() => {
  "use strict";

  const DB_NAME = "little-archive-db";
  const DB_VERSION = 1;

  let db;
  let currentFicId = null;
  let currentChapterIndex = 0;
  let draftChapters = [];
  let toastTimer;

  const $ = id => document.getElementById(id);

  const state = {
    fics: [],
    query: "",
    status: "all",
    sort: "added"
  };

  // DATABASE

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = () => {
        const database = req.result;

        if (!database.objectStoreNames.contains("fics")) {
          const store = database.createObjectStore("fics", {
            keyPath: "id"
          });
          store.createIndex("updatedAt", "updatedAt");
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function store(mode = "readonly") {
    return db.transaction("fics", mode).objectStore("fics");
  }

  function getAll() {
    return new Promise((resolve, reject) => {
      const req = store().getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  function saveFic(fic) {
    return new Promise((resolve, reject) => {
      const req = store("readwrite").put(fic);
      req.onsuccess = () => resolve(fic);
      req.onerror = () => reject(req.error);
    });
  }

  function deleteFic(id) {
    return new Promise((resolve, reject) => {
      const req = store("readwrite").delete(id);
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    });
  }

  // HELPERS

  function uid() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[ch]));
  }

  function cleanHTML(input) {
    const doc = new DOMParser().parseFromString(
      String(input || ""),
      "text/html"
    );

    doc.querySelectorAll(
      "script, iframe, frame, frameset, object, embed, applet, form, input, button, textarea, select, meta[http-equiv], base, link[rel=import]"
    ).forEach(el => el.remove());

    doc.querySelectorAll("*").forEach(el => {
      [...el.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();

        if (
          name.startsWith("on") ||
          name === "srcdoc" ||
          (
            ["href", "src", "xlink:href", "action"].includes(name) &&
            value.startsWith("javascript:")
          )
        ) {
          el.removeAttribute(attr.name);
        }
      });

      if (el.tagName === "A") {
        const href = el.getAttribute("href") || "";

        if (/^\s*(javascript|data):/i.test(href)) {
          el.removeAttribute("href");
        }

        el.setAttribute("rel", "noopener noreferrer");
      }
    });

    return doc.body.innerHTML ||
      `<p>${escapeHTML(doc.body.textContent || "")}</p>`;
  }

  function plainText(input) {
    const doc = new DOMParser().parseFromString(
      String(input || ""),
      "text/html"
    );

    return (doc.body.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function wordCount(html) {
    const text = plainText(html);
    return text ? text.split(/\s+/).filter(Boolean).length : 0;
  }

  function formatNumber(number) {
    return Number(number || 0).toLocaleString("en-CA");
  }

  function dateLabel(timestamp) {
    if (!timestamp) return "Just added";

    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(new Date(timestamp));
  }

  function toast(message) {
    $("toast").textContent = message;
    $("toast").classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      $("toast").classList.remove("show");
    }, 2600);
  }

  function currentStatus(fic) {
    if (fic.read) return "read";
    if (fic.lastOpenedAt) return "reading";
    return "unread";
  }

  function statusText(fic) {
    return {
      unread: "Unread",
      reading: "In progress",
      read: "Finished"
    }[currentStatus(fic)];
  }

  // SEARCH AND FILTERS

  function visibleFics() {
    let list = [...state.fics];

    const query = state.query.trim().toLocaleLowerCase("en-CA");

    if (query) {
      list = list.filter(fic =>
        [
          fic.title,
          fic.author,
          fic.fandom,
          fic.summary,
          ...(fic.tags || [])
        ].join(" ").toLocaleLowerCase("en-CA").includes(query)
      );
    }

    const includeTags = $("includeTagsInput").value
      .split(",")
      .map(tag => tag.trim().toLocaleLowerCase("en-CA"))
      .filter(Boolean);

    const excludeTags = $("excludeTagsInput").value
      .split(",")
      .map(tag => tag.trim().toLocaleLowerCase("en-CA"))
      .filter(Boolean);

    if (includeTags.length) {
      const matchMode = $("tagMatchMode").value;

      list = list.filter(fic => {
        const ficTags = (fic.tags || []).map(tag =>
          tag.toLocaleLowerCase("en-CA")
        );

        if (matchMode === "all") {
          return includeTags.every(tag => ficTags.includes(tag));
        }

        return includeTags.some(tag => ficTags.includes(tag));
      });
    }

    if (excludeTags.length) {
      list = list.filter(fic => {
        const ficTags = (fic.tags || []).map(tag =>
          tag.toLocaleLowerCase("en-CA")
        );

        return !excludeTags.some(tag => ficTags.includes(tag));
      });
    }

    const keyword = $("keywordSearchInput").value
      .trim()
      .toLocaleLowerCase("en-CA");

    if (keyword) {
      list = list.filter(fic =>
        [
          fic.title,
          fic.summary,
          ...(fic.tags || [])
        ].join(" ").toLocaleLowerCase("en-CA").includes(keyword)
      );
    }

    // Relationship search with Any / All matching.
    const searchedRelationships = $("relationshipSearchInput").value
      .split(",")
      .map(relationship =>
        relationship.trim().toLocaleLowerCase("en-CA")
      )
      .filter(Boolean);

    if (searchedRelationships.length) {
      const matchMode = $("relationshipMatchMode").value;

      list = list.filter(fic => {
        const ficRelationships = (fic.relationships || []).map(
          relationship => relationship.toLocaleLowerCase("en-CA")
        );

        if (matchMode === "all") {
          return searchedRelationships.every(relationship =>
            ficRelationships.includes(relationship)
          );
        }

        return searchedRelationships.some(relationship =>
          ficRelationships.includes(relationship)
        );
      });
    }

    const selectedRelationship = $("relationshipFilter").value
      .toLocaleLowerCase("en-CA");

    if (selectedRelationship) {
      list = list.filter(fic =>
        (fic.relationships || []).some(relationship =>
          relationship.toLocaleLowerCase("en-CA") === selectedRelationship
        )
      );
    }

    if (state.status === "bookmarked") {
      list = list.filter(fic => fic.bookmarked);
    } else if (state.status !== "all") {
      list = list.filter(fic => currentStatus(fic) === state.status);
    }

    const sorters = {
      added: (a, b) => b.createdAt - a.createdAt,
      updated: (a, b) => b.updatedAt - a.updatedAt,
      opened: (a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0),
      title: (a, b) => a.title.localeCompare(b.title, "en-CA"),
      titleDesc: (a, b) => b.title.localeCompare(a.title, "en-CA"),
      author: (a, b) =>
        (a.author || "").localeCompare(b.author || "", "en-CA"),
      authorDesc: (a, b) =>
        (b.author || "").localeCompare(a.author || "", "en-CA"),
      words: (a, b) =>
        (b.words || wordCount(b.content)) -
        (a.words || wordCount(a.content)),
      wordsAsc: (a, b) =>
        (a.words || wordCount(a.content)) -
        (b.words || wordCount(b.content))
    };

    return list.sort(sorters[state.sort] || sorters.added);
  }

  // STORY CARDS

  const expandedCards = new Set();

  function renderLibrary() {
    const relationshipFilter = $("relationshipFilter");
    const selectedRelationship = relationshipFilter.value;

    const relationships = [
      ...new Set(
        state.fics.flatMap(fic => fic.relationships || [])
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

    $("ficGrid").innerHTML = list.map(fic => {
      const expanded = expandedCards.has(fic.id);

      const tags = (fic.tags || []).map(tag =>
        `<span class="tag" data-filter-tag="${escapeHTML(tag)}">${escapeHTML(tag)}</span>`
      ).join("");

      const relationshipTags = (fic.relationships || []).map(
        relationship =>
          `<span class="tag" data-filter-relationship="${escapeHTML(relationship)}">${escapeHTML(relationship)}</span>`
      ).join("");

      const summary = fic.summary
        ? `<p class="card-summary" ${
            expanded
              ? 'style="display:block;overflow:visible;max-height:none;-webkit-line-clamp:unset;"'
              : ""
          }>${escapeHTML(fic.summary)}</p>`
        : "";

      const chapters = normaliseChapters(fic);

      const words = chapters.reduce((total, chapter) =>
        total + wordCount(chapter.content), 0
      );

      const chapterCount = chapters.length;

      const showExpandButton =
        (fic.tags || []).length > 3 ||
        (fic.summary || "").length > 180;

      return `
        <article
          class="fic-card ${expanded ? "expanded" : ""}"
          tabindex="0"
          role="button"
          data-open="${escapeHTML(fic.id)}"
          aria-label="Read ${escapeHTML(fic.title)}"
        >
          <div class="card-top">
            <span class="card-fandom">
              ${escapeHTML(fic.fandom || "Uncategorised")}
            </span>

            <div class="card-actions">
              <button
                class="card-delete"
                data-delete="${escapeHTML(fic.id)}"
                aria-label="Delete ${escapeHTML(fic.title)}"
                title="Delete fic"
                type="button"
              >☠︎︎</button>

              <button
                class="card-bookmark"
                data-bookmark="${escapeHTML(fic.id)}"
                aria-label="${fic.bookmarked ? "Remove bookmark" : "Bookmark"}"
                title="${fic.bookmarked ? "Remove bookmark" : "Bookmark"}"
                type="button"
              >${fic.bookmarked ? "♥" : "♡"}</button>
            </div>
          </div>

          <h3>${escapeHTML(fic.title)}</h3>

          <p class="card-author">
            ${fic.author ? "by " + escapeHTML(fic.author) : "Author unknown"}
          </p>

          ${summary}

          <div class="tag-list">${tags}</div>
          <div class="tag-list">${relationshipTags}</div>

          ${showExpandButton ? `
            <button
              class="expand-card-btn"
              data-expand="${escapeHTML(fic.id)}"
              type="button"
            >
              ${expanded ? "Show less ▲" : "Show more ▼"}
            </button>
          ` : ""}

          <div class="card-bottom">
            <span>
              ${formatNumber(words)} words ·
              ${chapterCount} ${chapterCount === 1 ? "chapter" : "chapters"} ·
              ${dateLabel(fic.createdAt)}
            </span>

            <span class="status-pill ${fic.read ? "read" : ""}">
              ${statusText(fic)}
            </span>
          </div>
        </article>
      `;
    }).join("");

    const empty = list.length === 0;

    $("emptyState").classList.toggle("show", empty);
    $("ficGrid").classList.toggle("hidden", empty);

    if (empty && state.fics.length) {
      $("emptyState").querySelector("h3").textContent =
        "No stories found.";

      $("emptyState").querySelector("p").textContent =
        "Try another search or clear your filters to see your whole collection.";

      $("emptyState").querySelector("button").classList.add("hidden");
    } else {
      $("emptyState").querySelector("h3").textContent =
        "Your shelf is waiting.";

      $("emptyState").querySelector("p").textContent =
        "Add a fic by pasting its HTML or importing a file from your device.";

      $("emptyState").querySelector("button").classList.remove("hidden");
    }
  }

  // READER

  function showLibrary() {
    $("libraryView").classList.remove("hidden");
    $("readerView").classList.add("hidden");

    currentFicId = null;

    renderLibrary();
    window.scrollTo(0, 0);
  }

  async function openReader(id) {
    const fic = state.fics.find(fic => fic.id === id);
    if (!fic) return;

    currentFicId = id;
    fic.lastOpenedAt = Date.now();
    fic.updatedAt = fic.updatedAt || Date.now();

    await saveFic(fic);

    $("readerFandom").textContent =
      fic.fandom || "A story from your collection";

    $("readerTitle").textContent = fic.title;

    $("readerAuthor").textContent =
      fic.author ? `by ${fic.author}` : "Author unknown";

    $("readerBadges").innerHTML =
      `<span class="badge">${escapeHTML(fic.rating || "Not rated")}</span>` +
      (fic.read ? '<span class="badge">Finished</span>' : "");

    const chapters = normaliseChapters(fic);

    const totalWords = fic.words ||
      chapters.reduce((sum, chapter) =>
        sum + wordCount(chapter.content), 0
      );

    $("readerStats").textContent =
      `${formatNumber(totalWords)} words · ` +
      `${chapters.length} ${chapters.length === 1 ? "chapter" : "chapters"} · ` +
      `Added ${dateLabel(fic.createdAt)}`;

    $("readerSummary").textContent = fic.summary || "";
    $("readerSummary").classList.toggle("hidden", !fic.summary);

    $("readerTags").innerHTML = (fic.tags || []).map(tag =>
      `<span class="tag">${escapeHTML(tag)}</span>`
    ).join("");

    currentChapterIndex = Math.min(
      currentChapterIndex,
      chapters.length - 1
    );

    setChapter(currentChapterIndex, false);

    $("readerBookmarkBtn").textContent =
      fic.bookmarked ? "♥" : "♡";

    $("readerBookmarkBtn").setAttribute(
      "aria-label",
      fic.bookmarked ? "Remove bookmark" : "Bookmark"
    );

    $("readStatusLabel").textContent = statusText(fic);

    $("toggleReadBtn").textContent =
      fic.read ? "Mark as unread ↺" : "Mark as finished ✓";

    $("libraryView").classList.add("hidden");
    $("readerView").classList.remove("hidden");

    renderLibrary();
    window.scrollTo(0, 0);
  }

  // CHAPTERS

  function normaliseChapters(fic) {
    if (Array.isArray(fic?.chapters) && fic.chapters.length) {
      return fic.chapters.map((chapter, index) => ({
        id: chapter.id || uid(),
        title: String(chapter.title || `Chapter ${index + 1}`),
        content: String(chapter.content || "")
      }));
    }

    return [{
      id: uid(),
      title: "Chapter 1",
      content: String(fic?.content || "")
    }];
  }

  function renderChapterEditor() {
    const host = $("chapterEditorList");

    host.innerHTML = draftChapters.map((chapter, index) => `
      <section class="chapter-edit-card" data-chapter-card="${index}">
        <div class="chapter-edit-header">
          <span class="chapter-number">CH. ${index + 1}</span>

          <input
            data-chapter-title="${index}"
            aria-label="Chapter ${index + 1} title"
            maxlength="240"
            value="${escapeHTML(chapter.title)}"
            placeholder="Chapter title"
          >

          <div class="chapter-edit-reorder">
            <button
              type="button"
              data-move-chapter="${index}"
              data-direction="-1"
              ${index === 0 ? "disabled" : ""}
              aria-label="Move chapter up"
            >↑</button>

            <button
              type="button"
              data-move-chapter="${index}"
              data-direction="1"
              ${index === draftChapters.length - 1 ? "disabled" : ""}
              aria-label="Move chapter down"
            >↓</button>

            <button
              type="button"
              data-delete-chapter="${index}"
              aria-label="Delete chapter"
              title="Delete chapter"
            >×</button>
          </div>
        </div>

        <textarea
          data-chapter-content="${index}"
          rows="7"
          aria-label="Chapter ${index + 1} HTML or text"
          placeholder="Chapter content..."
        >${escapeHTML(chapter.content)}</textarea>
      </section>
    `).join("");
  }

  function readChapterEditor() {
    $("chapterEditorList")
      .querySelectorAll("[data-chapter-title]")
      .forEach(input => {
        const index = Number(input.dataset.chapterTitle);

        if (draftChapters[index]) {
          draftChapters[index].title = input.value;
        }
      });

    $("chapterEditorList")
      .querySelectorAll("[data-chapter-content]")
      .forEach(input => {
        const index = Number(input.dataset.chapterContent);

        if (draftChapters[index]) {
          draftChapters[index].content = input.value;
        }
      });
  }

  function setChapter(index, scroll = true) {
    const fic = state.fics.find(fic => fic.id === currentFicId);
    if (!fic) return;

    const chapters = normaliseChapters(fic);

    currentChapterIndex = Math.max(
      0,
      Math.min(index, chapters.length - 1)
    );

    const chapter = chapters[currentChapterIndex];

    $("ficContent").innerHTML = cleanHTML(
      chapter.content ||
      "<p><em>This chapter has no content yet.</em></p>"
    );

    $("chapterNavigation").classList.toggle(
      "hidden",
      chapters.length <= 1
    );

    $("bottomChapterNavigation").classList.toggle(
      "hidden",
      chapters.length <= 1
    );

    $("chapterPicker").innerHTML = chapters.map((chapter, chapterIndex) =>
      `<option value="${chapterIndex}">${chapterIndex + 1}. ${escapeHTML(chapter.title)}</option>`
    ).join("");

    $("chapterPicker").value = String(currentChapterIndex);

    $("chapterPosition").textContent =
      `${currentChapterIndex + 1} of ${chapters.length}`;

    $("prevChapterBtn").disabled = currentChapterIndex === 0;
    $("prevChapterBottomBtn").disabled = currentChapterIndex === 0;

    $("nextChapterBtn").disabled =
      currentChapterIndex === chapters.length - 1;

    $("nextChapterBottomBtn").disabled =
      currentChapterIndex === chapters.length - 1;

    if (scroll) window.scrollTo(0, 0);
  }

  // ADD / EDIT STORY

  function openDialog(fic = null) {
    $("ficForm").reset();

    $("ficId").value = fic ? fic.id : "";
    $("dialogTitle").textContent =
      fic ? "Edit your fic" : "Add a fic";

    $("titleInput").value = fic?.title || "";
    $("authorInput").value = fic?.author || "";
    $("fandomInput").value = fic?.fandom || "";
    $("ratingInput").value = fic?.rating || "Not rated";
    $("wordsInput").value = fic?.words || "";

    $("tagsInput").value = (fic?.tags || []).join(", ");
    $("relationshipsInput").value =
      (fic?.relationships || []).join(", ");

    $("summaryInput").value = fic?.summary || "";

    draftChapters = normaliseChapters(fic);

    renderChapterEditor();

    $("fileName").textContent = "";
    $("ficDialog").showModal();

    setTimeout(() => $("titleInput").focus(), 30);
  }

  function closeDialog() {
    $("ficDialog").close();
  }

  // AUTOCOMPLETE FOR TAGS AND RELATIONSHIPS

  function setupSuggestions(inputId, suggestionsId, propertyName) {
    const input = $(inputId);
    const suggestions = $(suggestionsId);

    function updateSuggestions() {
      const typed = input.value
        .split(",")
        .pop()
        .trim()
        .toLocaleLowerCase("en-CA");

      suggestions.replaceChildren();
      suggestions.hidden = true;

      if (!typed) return;

      const existing = [
        ...new Map(
          state.fics
            .flatMap(fic => fic[propertyName] || [])
            .map(value => [
              value.toLocaleLowerCase("en-CA"),
              value
            ])
        ).values()
      ];

      const matches = existing
        .filter(value =>
          value.toLocaleLowerCase("en-CA").includes(typed)
        )
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

          input.dispatchEvent(new Event("input", {
            bubbles: true
          }));

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

  setupSuggestions("tagsInput", "tagSuggestions", "tags");

  setupSuggestions(
    "relationshipsInput",
    "relationshipSuggestions",
    "relationships"
  );

  setupSuggestions(
    "includeTagsInput",
    "includeTagSuggestions",
    "tags"
  );

  setupSuggestions(
    "excludeTagsInput",
    "excludeTagSuggestions",
    "tags"
  );

  setupSuggestions(
    "relationshipSearchInput",
    "relationshipSearchSuggestions",
    "relationships"
  );

  function parseTags(value) {
    const tags = value
      .split(",")
      .map(tag => tag.trim())
      .filter(Boolean);

    return tags.filter((tag, index) =>
      tags.findIndex(other =>
        other.toLocaleLowerCase("en-CA") ===
        tag.toLocaleLowerCase("en-CA")
      ) === index
    ).slice(0, 80);
  }

  // REFRESH AND BOOKMARKS

  async function refresh() {
    state.fics = await getAll();
    renderLibrary();
  }

  async function toggleBookmark(id) {
    const fic = state.fics.find(fic => fic.id === id);
    if (!fic) return;

    fic.bookmarked = !fic.bookmarked;
    fic.updatedAt = Date.now();

    await saveFic(fic);
    await refresh();

    if (currentFicId === id) {
      $("readerBookmarkBtn").textContent =
        fic.bookmarked ? "♥" : "♡";
    }
  }

  // BACKUP

  async function exportBackup() {
    const data = {
      app: "Berry’s Archive",
      version: 1,
      exportedAt: new Date().toISOString(),
      fics: await getAll()
    };

    const blob = new Blob(
      [JSON.stringify(data, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download =
      `berrys-archive-backup-${new Date().toISOString().slice(0, 10)}.json`;

    link.click();
    URL.revokeObjectURL(url);

    toast("Backup exported. Keep it somewhere safe.");
  }

  async function importBackup(file) {
    try {
      const data = JSON.parse(await file.text());

      if (!data || !Array.isArray(data.fics)) {
        throw new Error(
          "That file does not look like a Berry’s Archive backup."
        );
      }

      if (!confirm(
        `Import ${data.fics.length} stories? Stories with matching IDs will be replaced. Export a backup first if you want a safety copy.`
      )) {
        return;
      }

      for (const raw of data.fics) {
        if (!raw || !raw.title) continue;

        const importedChapters =
          Array.isArray(raw.chapters) && raw.chapters.length
            ? raw.chapters.map((chapter, index) => ({
                id: chapter.id || uid(),
                title: String(
                  chapter.title || `Chapter ${index + 1}`
                ),
                content: cleanHTML(chapter.content || "")
              }))
            : [{
                id: uid(),
                title: "Chapter 1",
                content: cleanHTML(raw.content || "")
              }];

        await saveFic({
          ...raw,
          id: raw.id || uid(),
          title: String(raw.title),
          chapters: importedChapters,
          content: importedChapters
            .map(chapter => chapter.content)
            .join("\n"),
          tags: Array.isArray(raw.tags) ? raw.tags : [],
          updatedAt: Date.now()
        });
      }

      await refresh();
      toast("Backup imported.");
    } catch (error) {
      toast(error.message || "Could not import that backup.");
    }

    $("backupInput").value = "";
  }

  // BUTTONS AND EVENTS

  $("addBtn").addEventListener("click", () => openDialog());
  $("emptyAddBtn").addEventListener("click", () => openDialog());

  $("homeBtn").addEventListener("click", showLibrary);
  $("backBtn").addEventListener("click", showLibrary);
  $("readerBackBottom").addEventListener("click", showLibrary);

  $("closeDialogBtn").addEventListener("click", closeDialog);
  $("cancelDialogBtn").addEventListener("click", closeDialog);

  $("ficDialog").addEventListener("click", event => {
    if (event.target === $("ficDialog")) closeDialog();
  });

  $("searchInput").addEventListener("input", event => {
    state.query = event.target.value;
    renderLibrary();
  });

  $("keywordSearchInput").addEventListener(
    "input",
    renderLibrary
  );

  $("includeTagsInput").addEventListener(
    "input",
    renderLibrary
  );

  $("excludeTagsInput").addEventListener(
    "input",
    renderLibrary
  );

  $("tagMatchMode").addEventListener(
    "change",
    renderLibrary
  );

  $("statusFilter").addEventListener("change", event => {
    state.status = event.target.value;
    renderLibrary();
  });

  $("relationshipFilter").addEventListener(
    "change",
    renderLibrary
  );

  $("relationshipSearchInput").addEventListener(
    "input",
    renderLibrary
  );

  $("relationshipMatchMode").addEventListener(
    "change",
    renderLibrary
  );

  $("sortSelect").addEventListener("change", event => {
    state.sort = event.target.value;
    renderLibrary();
  });

  // CLEAR FILTERS

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
    $("relationshipSearchInput").value = "";
    $("relationshipMatchMode").value = "any";

    renderLibrary();
  });

  // CLICKING STORY CARDS, TAGS, AND RELATIONSHIPS

  $("ficGrid").addEventListener("click", async event => {
    const clickedRelationship = event.target.closest(
      "[data-filter-relationship]"
    );

    if (clickedRelationship) {
      event.stopPropagation();

      $("relationshipFilter").value = "";
      $("relationshipSearchInput").value =
        clickedRelationship.dataset.filterRelationship;

      $("relationshipMatchMode").value = "any";

      renderLibrary();
      return;
    }

    const expandButton = event.target.closest("[data-expand]");

    if (expandButton) {
      event.stopPropagation();

      const ficId = expandButton.dataset.expand;

      if (expandedCards.has(ficId)) {
        expandedCards.delete(ficId);
      } else {
        expandedCards.add(ficId);
      }

      renderLibrary();
      return;
    }

    const clickedTag = event.target.closest("[data-filter-tag]");

    if (clickedTag) {
      event.stopPropagation();

      $("includeTagsInput").value =
        clickedTag.dataset.filterTag;

      $("tagMatchMode").value = "any";

      renderLibrary();
      return;
    }

    const deleteButton = event.target.closest("[data-delete]");

    if (deleteButton) {
      event.stopPropagation();

      const ficId = deleteButton.dataset.delete;
      const fic = state.fics.find(fic => fic.id === ficId);

      if (!fic) return;

      const confirmed = confirm(
        `Are you sure you want to delete "${fic.title}"?\n\n` +
        "This will permanently delete the fic and its chapters. " +
        "This action cannot be undone."
      );

      if (!confirmed) return;

      try {
        await deleteFic(ficId);
        await refresh();
        toast("Fic deleted successfully.");
      } catch (error) {
        toast("Could not delete this fic. Please try again.");
        console.error("Error deleting fic:", error);
      }

      return;
    }

    const bookmark = event.target.closest("[data-bookmark]");

    if (bookmark) {
      event.stopPropagation();
      await toggleBookmark(bookmark.dataset.bookmark);
      return;
    }

    const card = event.target.closest("[data-open]");

    if (card) {
      await openReader(card.dataset.open);
    }
  });

  $("ficGrid").addEventListener("keydown", async event => {
    if (
      (event.key === "Enter" || event.key === " ") &&
      event.target.matches("[data-open]")
    ) {
      event.preventDefault();
      await openReader(event.target.dataset.open);
    }
  });

  // READER BUTTONS

  $("readerBookmarkBtn").addEventListener("click", async () => {
    if (currentFicId) await toggleBookmark(currentFicId);
  });

  $("editFicBtn").addEventListener("click", () => {
    const fic = state.fics.find(fic => fic.id === currentFicId);
    if (fic) openDialog(fic);
  });

  $("toggleReadBtn").addEventListener("click", async () => {
    const fic = state.fics.find(fic => fic.id === currentFicId);
    if (!fic) return;

    fic.read = !fic.read;
    fic.updatedAt = Date.now();

    await saveFic(fic);
    await refresh();
    await openReader(fic.id);
  });

  // IMPORT STORY FILE

  $("ficFileInput").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();

      readChapterEditor();

      const content = file.name.toLowerCase().endsWith(".txt")
        ? `<p>${escapeHTML(text).replace(/\r?\n/g, "<br>")}</p>`
        : cleanHTML(text);

      if (!draftChapters.length) {
        draftChapters = [{
          id: uid(),
          title: "Chapter 1",
          content
        }];
      } else {
        draftChapters[0].content = content;
      }

      if (
        !draftChapters[0].title ||
        draftChapters[0].title === "Chapter 1"
      ) {
        draftChapters[0].title = "Chapter 1";
      }

      renderChapterEditor();

      $("fileName").textContent =
        `Loaded: ${file.name} (${formatNumber(file.size)} bytes) into Chapter 1`;

      if (!$("titleInput").value) {
        $("titleInput").value = file.name
          .replace(/\.(html?|xhtml|txt)$/i, "")
          .replace(/[_-]+/g, " ");
      }

      toast("File loaded into Chapter 1. Save the fic to keep it in your library.");
    } catch {
      toast("Sorry, that file could not be read.");
    }

    event.target.value = "";
  });

  // ADD CHAPTER

  $("addChapterBtn").addEventListener("click", () => {
    readChapterEditor();

    draftChapters.push({
      id: uid(),
      title: `Chapter ${draftChapters.length + 1}`,
      content: ""
    });

    renderChapterEditor();

    const inputs = $("chapterEditorList").querySelectorAll(
      "[data-chapter-title]"
    );

    inputs[inputs.length - 1]?.focus();
  });

  // EDIT CHAPTER CONTENT

  $("chapterEditorList").addEventListener("input", event => {
    if (event.target.matches("[data-chapter-title]")) {
      const index = Number(event.target.dataset.chapterTitle);

      if (draftChapters[index]) {
        draftChapters[index].title = event.target.value;
      }
    } else if (event.target.matches("[data-chapter-content]")) {
      const index = Number(event.target.dataset.chapterContent);

      if (draftChapters[index]) {
        draftChapters[index].content = event.target.value;
      }
    }
  });

  // MOVE OR DELETE CHAPTERS

  $("chapterEditorList").addEventListener("click", event => {
    const deleteButton = event.target.closest(
      "[data-delete-chapter]"
    );

    const moveButton = event.target.closest(
      "[data-move-chapter]"
    );

    if (!deleteButton && !moveButton) return;

    readChapterEditor();

    if (deleteButton) {
      const index = Number(deleteButton.dataset.deleteChapter);

      if (draftChapters.length === 1) {
        toast("A fic needs at least one chapter.");
        return;
      }

      if (!confirm(`Delete Chapter ${index + 1}? This chapter's content will be removed when you save.`)) {
        return;
      }

      draftChapters.splice(index, 1);
    } else {
      const index = Number(moveButton.dataset.moveChapter);
      const nextIndex = index + Number(moveButton.dataset.direction);

      if (nextIndex < 0 || nextIndex >= draftChapters.length) {
        return;
      }

      [draftChapters[index], draftChapters[nextIndex]] =
        [draftChapters[nextIndex], draftChapters[index]];
    }

    renderChapterEditor();
  });

  // CHAPTER NAVIGATION

  $("chapterPicker").addEventListener("change", event => {
    setChapter(Number(event.target.value));
  });

  $("prevChapterBtn").addEventListener("click", () => {
    setChapter(currentChapterIndex - 1);
  });

  $("nextChapterBtn").addEventListener("click", () => {
    setChapter(currentChapterIndex + 1);
  });

  $("prevChapterBottomBtn").addEventListener("click", () => {
    setChapter(currentChapterIndex - 1);
  });

  $("nextChapterBottomBtn").addEventListener("click", () => {
    setChapter(currentChapterIndex + 1);
  });

  // SAVE STORY

  $("ficForm").addEventListener("submit", async event => {
    event.preventDefault();

    const id = $("ficId").value || uid();
    const existing = state.fics.find(fic => fic.id === id);

    readChapterEditor();

    const chapters = draftChapters.map((chapter, index) => ({
      id: chapter.id || uid(),
      title: (chapter.title || "").trim() || `Chapter ${index + 1}`,
      content: cleanHTML(chapter.content || "")
    }));

    const totalWords = chapters.reduce(
      (sum, chapter) => sum + wordCount(chapter.content),
      0
    );

    const now = Date.now();

    const fic = {
      id,
      title: $("titleInput").value.trim(),
      author: $("authorInput").value.trim(),
      fandom: $("fandomInput").value.trim(),
      rating: $("ratingInput").value,

      words: Math.max(
        0,
        Number.parseInt($("wordsInput").value, 10) || totalWords
      ),

      tags: parseTags($("tagsInput").value),
      relationships: parseTags($("relationshipsInput").value),
      summary: $("summaryInput").value.trim(),
      chapters,

      content: chapters
        .map(chapter => chapter.content)
        .join("\n"),

      createdAt: existing?.createdAt || now,
      updatedAt: now,
      lastOpenedAt: existing?.lastOpenedAt || null,
      read: existing?.read || false,
      bookmarked: existing?.bookmarked || false
    };

    try {
      await saveFic(fic);
      await refresh();

      closeDialog();

      if (currentFicId === id) {
        await openReader(id);
      } else {
        showLibrary();
      }

      toast(
        existing
          ? "Your changes have been saved."
          : "Fic added to your library."
      );
    } catch {
      toast("Could not save this fic. Check available storage on your device.");
    }
  });

  // BACKUP BUTTONS

  $("backupBtn").addEventListener("click", exportBackup);

  $("backupInput").addEventListener("change", event => {
    if (event.target.files?.[0]) {
      importBackup(event.target.files[0]);
    }
  });

  // START THE APP

  (async () => {
    try {
      if (!("indexedDB" in window)) {
        throw new Error(
          "This browser does not support local offline storage."
        );
      }

      db = await openDB();
      await refresh();
    } catch (error) {
      $("emptyState").classList.add("show");

      $("emptyState").querySelector("h3").textContent =
        "Your library could not start.";

      $("emptyState").querySelector("p").textContent =
        `${error.message || "Browser storage is unavailable."} ` +
        "Try opening this folder in a current version of Firefox, Chrome, or Edge.";

      $("emptyState").querySelector("button").classList.add("hidden");
    }
  })();
})();
