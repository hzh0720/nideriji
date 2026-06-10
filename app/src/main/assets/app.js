(function () {
  "use strict";

  var API_ORIGIN = "https://nideriji.cn";
  var STORE_KEY = "ndrj_lite_state_v2";
  var CACHE_KEY = "ndrj_lite_cache_v2";
  var IMAGE_CACHE_PREFIX = "ndrj_img_";
  var IMAGE_TOKEN_RE = /\[(?:图|圖|鍥[^\d\]]*)(\d+)\]/g;

  var state = {
    tab: "write",
    token: "",
    meColor: "#2f7d68",
    pairedColor: "#c7505a",
    draftOwner: "me",
    draftDate: "",
    draftDiaryId: "",
    draftTitle: "",
    draftHtml: "",
    draftsByDate: {},
    replaceBackup: null,
    query: "",
    scope: "both",
    timelineView: "timeline",
    calendarMonth: "",
    syncing: false,
    saving: false,
    sync: null,
    diaries: [],
    images: {},
    readDiaryKeys: {},
    userConfig: null,
    lastSyncText: "还没有同步",
    lastSyncError: ""
  };

  var callbacks = {};
  var view = null;
  var imagePicker = null;
  var lastEditorRange = null;
  var lastTimelineTabTap = 0;
  var loadedDraftDate = "";

  window.NideRijiNative = {
    resolve: function (callbackId, raw) {
      this.resolveChunk(callbackId, 0, 1, raw);
    },
    resolveChunk: function (callbackId, index, total, chunk) {
      var pair = callbacks[callbackId];
      if (!pair) return;
      total = Number(total) || 1;
      index = Number(index) || 0;
      if (total > 1) {
        pair.chunks = pair.chunks || [];
        pair.received = pair.received || 0;
        if (pair.chunks[index] == null) pair.received += 1;
        pair.chunks[index] = chunk || "";
        if (pair.received < total) return;
        chunk = pair.chunks.join("");
      }
      delete callbacks[callbackId];
      try {
        pair.resolve(JSON.parse(chunk || "{}"));
      } catch (error) {
        pair.reject(error);
      }
    }
  };

  document.addEventListener("DOMContentLoaded", function () {
    view = document.getElementById("view");
    imagePicker = document.getElementById("image-picker");
    loadState();
    bindTabs();
    bindImagePicker();
    bindViewportMetrics();
    bindGlobalInteractionGuards();
    applyTheme();
    render();
    if (state.token && !state.diaries.length) {
      syncAll(false);
    }
  });

  function loadState() {
    try {
      Object.assign(state, JSON.parse(localStorage.getItem(STORE_KEY) || "{}"));
    } catch (error) {
      // Ignore broken local settings.
    }
    try {
      var cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
      state.sync = cache.sync || state.sync;
      state.diaries = Array.isArray(cache.diaries) ? cache.diaries : state.diaries;
      state.images = cache.images || state.images;
      state.readDiaryKeys = cache.readDiaryKeys || state.readDiaryKeys;
      state.userConfig = cache.userConfig || state.userConfig;
      state.lastSyncText = cache.lastSyncText || state.lastSyncText;
      state.lastSyncError = cache.lastSyncError || state.lastSyncError;
    } catch (error) {
      // Ignore broken cache.
    }
    normalizeDraftState();
    seedReadDiaryKeysIfEmpty();
  }

  function persistSettings() {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      tab: state.tab,
      token: state.token,
      meColor: state.meColor,
      pairedColor: state.pairedColor,
      draftOwner: state.draftOwner,
      draftDate: state.draftDate,
      draftDiaryId: state.draftDiaryId,
      draftTitle: state.draftTitle,
      draftHtml: state.draftHtml,
      draftsByDate: state.draftsByDate,
      replaceBackup: state.replaceBackup,
      query: state.query,
      scope: state.scope,
      timelineView: state.timelineView,
      calendarMonth: state.calendarMonth
    }));
  }

  function persistCache() {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      sync: state.sync,
      diaries: state.diaries,
      images: state.images,
      readDiaryKeys: state.readDiaryKeys,
      userConfig: state.userConfig,
      lastSyncText: state.lastSyncText,
      lastSyncError: state.lastSyncError
    }));
  }

  function normalizeDraftState() {
    state.draftOwner = "me";
    if (!isDateKey(state.draftDate)) state.draftDate = todayStamp();
    if (!state.draftsByDate || typeof state.draftsByDate !== "object" || Array.isArray(state.draftsByDate)) {
      state.draftsByDate = {};
    }
    if (!state.readDiaryKeys || typeof state.readDiaryKeys !== "object" || Array.isArray(state.readDiaryKeys)) {
      state.readDiaryKeys = {};
    }
    if (!state.draftDiaryId) state.draftDiaryId = "";
    if (!state.replaceBackup || typeof state.replaceBackup !== "object") state.replaceBackup = null;
    if (!state.draftsByDate[state.draftDate] && (state.draftTitle || state.draftHtml || state.draftDiaryId)) {
      state.draftsByDate[state.draftDate] = {
        title: state.draftTitle || "",
        html: state.draftHtml || "",
        diaryId: state.draftDiaryId || "",
        dirty: true,
        updatedAt: Date.now()
      };
    }
  }

  function bindTabs() {
    document.querySelectorAll(".tab").forEach(function (button) {
      button.addEventListener("click", function () {
        setWritingMode(false);
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        var shouldRender = true;
        if (button.dataset.tab === "timeline" && state.tab === "timeline") {
          var now = Date.now();
          if (now - lastTimelineTabTap < 420) {
            state.timelineView = state.timelineView === "calendar" ? "timeline" : "calendar";
            lastTimelineTabTap = 0;
          } else {
            lastTimelineTabTap = now;
            shouldRender = false;
          }
        } else {
          state.tab = button.dataset.tab;
          lastTimelineTabTap = button.dataset.tab === "timeline" ? Date.now() : 0;
        }
        if (!shouldRender) return;
        persistSettings();
        render();
      });
    });
  }

  function setActiveTab() {
    document.querySelectorAll(".tab").forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.tab === state.tab);
    });
  }

  function bindImagePicker() {
    imagePicker.addEventListener("change", function () {
      var files = Array.prototype.slice.call(imagePicker.files || []);
      if (!files.length) return;
      insertImageFiles(files);
      imagePicker.value = "";
    });
  }

  function bindGlobalInteractionGuards() {
    document.addEventListener("pointerdown", function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      if (target.closest("#editor, #title-input")) return;
      if (target.closest(".tab, [data-date-step], [data-date-option], [data-action='pick-date'], [data-scope], [data-view], [data-calendar-day], [data-diary], [data-profile-action]")) {
        setWritingMode(false);
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      }
    }, true);
  }

  function bindViewportMetrics() {
    var viewport = window.visualViewport;
    function update() {
      var keyboardOffset = 0;
      if (viewport) {
        keyboardOffset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      }
      document.documentElement.style.setProperty("--keyboard-offset", Math.round(keyboardOffset) + "px");
      document.body.classList.toggle("has-keyboard", keyboardOffset > 80);
    }
    if (viewport) {
      viewport.addEventListener("resize", update);
      viewport.addEventListener("scroll", update);
    }
    window.addEventListener("resize", update);
    update();
  }

  function setWritingMode(active) {
    document.body.classList.toggle("is-writing", !!active && state.tab === "write");
  }

  function deferWritingModeCheck() {
    setTimeout(function () {
      var active = document.activeElement;
      var writeCard = document.querySelector(".write-card");
      setWritingMode(!!(writeCard && active && writeCard.contains(active)));
    }, 80);
  }

  function applyTheme() {
    document.documentElement.style.setProperty("--me", state.meColor);
    document.documentElement.style.setProperty("--paired", state.pairedColor);
  }

  function render() {
    setActiveTab();
    applyTheme();
    if (state.tab !== "write") setWritingMode(false);
    if (state.tab === "write") renderWrite();
    if (state.tab === "timeline") renderTimeline();
    if (state.tab === "profile") renderProfile();
  }

  function renderWrite() {
    renderWriteV2();
    return;
    state.draftOwner = "me";
    view.innerHTML = [
      '<section class="page write-page">',
      '<section class="write-card">',
      '<div class="write-head">',
      '<div class="date-pill">' + icon("calendar") + '<span>' + escapeHtml(formatToday()) + "</span></div>",
      '<button class="icon-btn" data-action="sync" type="button" aria-label="同步">' + icon("refresh") + "</button>",
      "</div>",
      '<div class="editor-meta">',
      '<span class="owner-write-badge" style="color:var(--me)">写我的日记</span>',
      "</div>",
      '<input id="title-input" class="title-input" placeholder="标题" value="' + escapeAttr(state.draftTitle) + '">',
      toolbarHtml(),
      '<div class="editor-wrap"><div id="editor" class="editor" contenteditable="true" spellcheck="true" data-placeholder="写下今天。插入的图片会直接出现在这里。">' + state.draftHtml + "</div></div>",
      '<div class="editor-footer">',
      '<div class="save-state" id="save-state">' + editorStateText() + "</div>",
      '<div class="editor-actions">',
      '<button class="chip-btn" data-action="preview" type="button">预览</button>',
      '<button class="chip-btn" data-action="clear-draft" type="button">清空</button>',
      '<button class="solid-btn" data-tone="me" data-action="save" type="button">' + icon("check") + "<span>保存</span></button>",
      "</div>",
      "</div>",
      "</section>",
      "</section>"
    ].join("");

    var editor = document.getElementById("editor");
    var title = document.getElementById("title-input");
    title.addEventListener("input", function () {
      state.draftTitle = title.value;
      persistSettings();
    });
    title.addEventListener("focus", function () { setWritingMode(true); });
    title.addEventListener("blur", deferWritingModeCheck);
    title.addEventListener("keydown", function (event) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      editor.focus();
      placeCaretAtEnd(editor);
      rememberEditorRange();
    });
    editor.addEventListener("input", function () {
      syncEditorDraft();
    });
    ["keyup", "mouseup", "touchend", "focus"].forEach(function (eventName) {
      editor.addEventListener(eventName, rememberEditorRange);
    });
    bindEditorExperience(editor);
    bindToolbar(editor);
    bindEditorImageControls(editor);
    bindPageActions();
    updateSaveState();
    updateEditorEmptyState(editor);
  }

  function renderWriteV2() {
    state.draftOwner = "me";
    normalizeDraftState();
    if (loadedDraftDate !== state.draftDate) {
      loadDraftForDate(state.draftDate);
    }
    view.innerHTML = [
      '<section class="page write-page">',
      '<section class="write-card">',
      dateSelectorHtml(),
      '<input id="title-input" class="title-input" placeholder="标题" value="' + escapeAttr(state.draftTitle) + '">',
      toolbarHtml(),
      '<div class="editor-wrap"><div id="editor" class="editor" contenteditable="true" spellcheck="true" data-placeholder="写下这一天。插入的图片会直接出现在这里。">' + state.draftHtml + "</div></div>",
      '<div class="editor-footer">',
      '<div class="save-state" id="save-state">' + editorStateText() + "</div>",
      '<div class="editor-actions">',
      '<button class="chip-btn" data-action="preview" type="button">预览</button>',
      '<button class="chip-btn" data-action="clear-draft" type="button">清空</button>',
      '<button class="solid-btn" data-tone="me" data-action="save" type="button">' + icon("check") + "<span>保存</span></button>",
      "</div>",
      "</div>",
      "</section>",
      "</section>"
    ].join("");

    var editor = document.getElementById("editor");
    var title = document.getElementById("title-input");
    title.addEventListener("input", function () {
      state.draftTitle = title.value;
      saveCurrentDraft(true);
    });
    title.addEventListener("focus", function () { setWritingMode(true); });
    title.addEventListener("blur", deferWritingModeCheck);
    title.addEventListener("keydown", function (event) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      editor.focus();
      placeCaretAtEnd(editor);
      rememberEditorRange();
    });
    editor.addEventListener("input", function () {
      syncEditorDraft();
    });
    ["keyup", "mouseup", "touchend", "focus"].forEach(function (eventName) {
      editor.addEventListener(eventName, rememberEditorRange);
    });
    bindEditorExperience(editor);
    bindToolbar(editor);
    bindEditorImageControls(editor);
    bindDateSelector();
    bindPageActions();
    hydrateDiaryImages(editor);
    updateSaveState();
    updateEditorEmptyState(editor);
  }

  function dateSelectorHtml() {
    var center = dateFromKey(state.draftDate);
    var days = [];
    for (var offset = -3; offset <= 3; offset += 1) {
      days.push(shiftDate(state.draftDate, offset));
    }
    return [
      '<div class="date-selector">',
      '<button class="icon-btn date-step-btn" data-date-step="-1" type="button" aria-label="前一天">' + icon("chevronLeft") + "</button>",
      '<button class="date-current-btn" data-action="pick-date" type="button">',
      '<strong>' + escapeHtml(state.draftDate) + "</strong>",
      '<span>' + escapeHtml(weekdayText(center)) + "</span>",
      "</button>",
      '<button class="icon-btn date-step-btn" data-date-step="1" type="button" aria-label="后一天">' + icon("chevronRight") + "</button>",
      "</div>",
      '<div class="date-strip" aria-label="选择日期">' + days.map(function (date) {
        var day = dateFromKey(date);
        return [
          '<button class="date-chip' + (date === state.draftDate ? " is-active" : "") + (date === todayStamp() ? " is-today" : "") + '" data-date-option="' + escapeAttr(date) + '" type="button">',
          '<span>' + escapeHtml(weekdayText(day)) + "</span>",
          '<strong>' + day.getDate() + "</strong>",
          "</button>"
        ].join("");
      }).join("") + "</div>"
    ].join("");
  }

  function bindDateSelector() {
    view.querySelectorAll("[data-date-step]").forEach(function (button) {
      button.addEventListener("click", function () {
        changeDraftDate(shiftDate(state.draftDate, Number(button.dataset.dateStep || 0)));
      });
    });
    view.querySelectorAll("[data-date-option]").forEach(function (button) {
      button.addEventListener("click", function () {
        changeDraftDate(button.dataset.dateOption);
      });
    });
    var current = view.querySelector("[data-action='pick-date']");
    if (current) {
      current.addEventListener("click", function () {
        openNativeDatePicker();
      });
    }
  }

  function openNativeDatePicker() {
    var dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.className = "date-native-input";
    dateInput.value = state.draftDate;
    document.body.appendChild(dateInput);
    var done = false;
    function cleanup() {
      if (done) return;
      done = true;
      setTimeout(function () {
        if (dateInput.parentNode) dateInput.parentNode.removeChild(dateInput);
      }, 80);
    }
    setTimeout(cleanup, 15000);
    dateInput.addEventListener("change", function () {
      var value = dateInput.value;
      cleanup();
      changeDraftDate(value);
    });
    dateInput.focus();
    if (dateInput.showPicker) {
      dateInput.showPicker();
    } else {
      dateInput.click();
    }
  }

  function changeDraftDate(value) {
    var next = normalizeDateKey(value);
    if (!next || next === state.draftDate) return;
    setWritingMode(false);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    syncEditorDraft();
    state.draftDate = next;
    loadDraftForDate(next);
    persistSettings();
    setTimeout(function () {
      renderWrite();
      setWritingMode(false);
    }, 0);
  }

  function loadDraftForDate(date) {
    var key = normalizeDateKey(date) || todayStamp();
    state.draftDate = key;
    var local = state.draftsByDate && state.draftsByDate[key];
    var diary = findMyDiaryForDate(key);
    if (hasLocalDraft(local)) {
      state.draftTitle = local.title || "";
      state.draftHtml = local.html || "";
      state.draftDiaryId = local.diaryId || (diary && diary.id ? String(diary.id) : "");
      loadedDraftDate = key;
      return;
    }
    if (diary) {
      state.draftTitle = diary.title || "";
      state.draftHtml = diary.content
        ? officialContentToEditorHtml(diary.content, diary.userId)
        : diaryDisplayHtmlToEditorHtml(diary.html || "", diary.userId);
      state.draftDiaryId = diary.id ? String(diary.id) : "";
      loadedDraftDate = key;
      return;
    }
    state.draftTitle = "";
    state.draftHtml = "";
    state.draftDiaryId = "";
    loadedDraftDate = key;
  }

  function saveCurrentDraft(markDirty) {
    normalizeDraftState();
    var key = state.draftDate;
    var draft = {
      title: state.draftTitle || "",
      html: state.draftHtml || "",
      diaryId: state.draftDiaryId || "",
      dirty: !!markDirty,
      updatedAt: Date.now()
    };
    if (hasLocalDraft(draft)) {
      state.draftsByDate[key] = draft;
    } else if (state.draftsByDate) {
      delete state.draftsByDate[key];
    }
    persistSettings();
  }

  function hasLocalDraft(draft) {
    return !!(draft && (draft.dirty || draft.cleared || draft.title || draft.html || draft.diaryId));
  }

  function findMyDiaryForDate(date) {
    var key = normalizeDateKey(date);
    if (!key) return null;
    return state.diaries.filter(function (item) {
      return item.owner === "me" && dateKey(item.createddate) === key;
    }).sort(function (a, b) {
      return String(b.createddate || "").localeCompare(String(a.createddate || ""));
    })[0] || null;
  }

  function officialContentToEditorHtml(text, userId) {
    var html = [];
    var source = String(text || "").replace(/\r\n?/g, "\n");
    var last = 0;
    source.replace(IMAGE_TOKEN_RE, function (match, id, offset) {
      appendEditorText(html, source.slice(last, offset));
      html.push(editorImageBlockHtml(id, userId || state.images[String(id)] || ""));
      last = offset + match.length;
      return match;
    });
    appendEditorText(html, source.slice(last));
    return html.join("") || "";
  }

  function diaryDisplayHtmlToEditorHtml(html, userId) {
    var box = document.createElement("div");
    box.innerHTML = sanitizeEditorHtml(html || "");
    box.querySelectorAll("img[data-image-id]").forEach(function (image) {
      var id = image.dataset.imageId || "";
      if (!id) return;
      var wrapper = document.createElement("div");
      wrapper.innerHTML = editorImageBlockHtml(id, image.dataset.userId || userId || state.images[String(id)] || "", image.src || "");
      image.parentNode.replaceChild(wrapper.firstChild, image);
    });
    return box.innerHTML;
  }

  function appendEditorText(parts, text) {
    String(text || "").split(/\n{2,}/).forEach(function (block) {
      var clean = block.replace(/^\n+|\n+$/g, "");
      if (!clean.trim()) return;
      parts.push("<p>" + escapeHtml(clean).replace(/\n/g, "<br>") + "</p>");
    });
  }

  function editorImageBlockHtml(imageId, userId, src) {
    var id = String(imageId || "");
    var ownerId = userId || state.images[id] || currentUserId();
    return [
      '<figure class="image-block" contenteditable="false" data-upload-state="done" data-image-id="' + escapeAttr(id) + '" data-image-token="[图' + escapeAttr(id) + ']" data-user-id="' + escapeAttr(ownerId) + '">',
      '<div class="image-frame"><img' + (src ? ' src="' + escapeAttr(src) + '"' : "") + ' data-image-id="' + escapeAttr(id) + '" data-user-id="' + escapeAttr(ownerId) + '" alt="图片' + escapeAttr(id) + '"></div>',
      '<figcaption><span class="image-status">已上传</span><button class="image-action" data-image-action="remove" type="button" aria-label="删除图片">' + icon("close") + "</button></figcaption>",
      "</figure>"
    ].join("");
  }

  function normalizeDateKey(value) {
    var key = dateKey(value);
    return isDateKey(key) ? key : "";
  }

  function isDateKey(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
  }

  function dateFromKey(value) {
    var key = normalizeDateKey(value) || todayStamp();
    var parts = key.split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function shiftDate(value, step) {
    var date = dateFromKey(value);
    date.setDate(date.getDate() + Number(step || 0));
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  function headerHtml(eyebrow, title, actions) {
    return [
      '<div class="topbar">',
      "<div>",
      '<div class="eyebrow">' + escapeHtml(eyebrow) + "</div>",
      '<h1 class="title">' + escapeHtml(title) + "</h1>",
      "</div>",
      '<div style="display:flex;gap:8px">' + (actions || []).join("") + "</div>",
      "</div>"
    ].join("");
  }

  function authorSwitchHtml() {
    return [
      '<div class="author-switch">',
      '<button type="button" data-owner="me" class="' + (state.draftOwner === "me" ? "is-active" : "") + '">我</button>',
      '<button type="button" data-owner="paired" class="' + (state.draftOwner === "paired" ? "is-active" : "") + '">对方</button>',
      "</div>"
    ].join("");
  }

  function toolbarHtml() {
    return [
      '<div class="toolbar" aria-label="编辑工具栏">',
      toolButton("undo", icon("undo"), "撤销"),
      toolButton("redo", icon("redo"), "重做"),
      '<button class="toolbar-btn" data-tool="image" type="button" aria-label="插入图片">' + icon("image") + "</button>",
      '<button class="toolbar-btn" data-tool="paragraph" type="button" aria-label="换段">' + icon("paragraph") + "</button>",
      "</div>"
    ].join("");
  }

  function toolButton(command, label, ariaLabel) {
    return '<button class="toolbar-btn" data-command="' + command + '" type="button" aria-label="' + escapeAttr(ariaLabel || command) + '">' + label + "</button>";
  }

  function bindAuthorSwitch() {
    document.querySelectorAll(".author-switch button").forEach(function (button) {
      button.addEventListener("click", function () {
        state.draftOwner = button.dataset.owner;
        persistSettings();
        renderWrite();
      });
    });
  }

  function bindToolbar(editor) {
    document.querySelectorAll("[data-command]").forEach(function (button) {
      button.addEventListener("click", function () {
        restoreEditorRange(editor);
        editor.focus();
        document.execCommand(button.dataset.command, false, null);
        syncEditorDraft();
      });
    });
    var imageButton = document.querySelector("[data-tool='image']");
    imageButton.addEventListener("pointerdown", function () {
      rememberEditorRange();
    });
    imageButton.addEventListener("click", function () {
      if (!state.token) {
        toast("先登录后可以插入图片");
        state.tab = "profile";
        render();
        return;
      }
      rememberEditorRange();
      pickAndInsertImage();
    });
    document.querySelector("[data-tool='paragraph']").addEventListener("click", function () {
      restoreEditorRange(editor);
      editor.focus();
      insertEditorHtml(editor, "<p><br></p>");
      syncEditorDraft();
    });
  }

  function bindEditorExperience(editor) {
    editor.addEventListener("focus", function () {
      setWritingMode(true);
      updateEditorEmptyState(editor);
    });
    editor.addEventListener("blur", deferWritingModeCheck);
    editor.addEventListener("paste", function (event) {
      handleEditorPaste(event, editor);
    });
    editor.addEventListener("dragover", function (event) {
      if (hasImageFiles(event.dataTransfer)) event.preventDefault();
    });
    editor.addEventListener("drop", function (event) {
      if (!hasImageFiles(event.dataTransfer)) return;
      event.preventDefault();
      rememberEditorRange();
      insertImageFiles(Array.prototype.slice.call(event.dataTransfer.files || []));
    });
    editor.addEventListener("keydown", function (event) {
      if (handleImageEdgeDelete(event, editor)) return;
      if (event.key === "Enter" && event.shiftKey) {
        event.preventDefault();
        insertEditorHtml(editor, "<br>");
        syncEditorDraft();
      }
    });
    editor.addEventListener("keyup", function () {
      updateEditorEmptyState(editor);
      keepCaretVisible();
    });
    editor.addEventListener("touchend", function () {
      setTimeout(keepCaretVisible, 80);
    });
  }

  function handleEditorPaste(event, editor) {
    var clipboard = event.clipboardData || window.clipboardData;
    if (!clipboard) return;
    var files = imageFilesFromTransfer(clipboard);
    if (files.length) {
      event.preventDefault();
      insertImageFiles(files);
      return;
    }
    var text = clipboard.getData("text/plain");
    if (text) {
      event.preventDefault();
      insertPlainText(editor, text);
      syncEditorDraft();
    }
  }

  function imageFilesFromTransfer(transfer) {
    var files = [];
    Array.prototype.slice.call((transfer && transfer.items) || []).forEach(function (item) {
      if (item.kind === "file" && /^image\//i.test(item.type || "")) {
        var file = item.getAsFile();
        if (file) files.push(file);
      }
    });
    Array.prototype.slice.call((transfer && transfer.files) || []).forEach(function (file) {
      if (/^image\//i.test(file.type || "") && files.indexOf(file) < 0) files.push(file);
    });
    return files;
  }

  function hasImageFiles(transfer) {
    return imageFilesFromTransfer(transfer).length > 0;
  }

  function insertPlainText(editor, text) {
    var clean = String(text || "")
      .replace(/\r\n?/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n");
    insertEditorHtml(editor, escapeHtml(clean).replace(/\n/g, "<br>"));
  }

  function handleImageEdgeDelete(event, editor) {
    if (event.key !== "Backspace" && event.key !== "Delete") return false;
    var selection = window.getSelection && window.getSelection();
    if (!selection || !selection.rangeCount || !selection.isCollapsed) return false;
    var range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return false;
    var block = adjacentImageBlock(range, event.key === "Backspace" ? "before" : "after");
    if (!block) return false;
    event.preventDefault();
    var caretTarget = event.key === "Backspace" ? ensureTextBlockBefore(block) : ensureTextBlockAfter(block);
    block.remove();
    placeCaretInside(caretTarget);
    syncEditorDraft();
    return true;
  }

  function adjacentImageBlock(range, direction) {
    var node = range.startContainer;
    var offset = range.startOffset;
    if (node.nodeType === 3) {
      if (direction === "before" && offset > 0) return null;
      if (direction === "after" && offset < node.nodeValue.length) return null;
      return direction === "before"
        ? closestImageBlock(previousMeaningfulNode(node))
        : closestImageBlock(nextMeaningfulNode(node));
    }
    if (!node || node.nodeType !== 1) return null;
    if (direction === "before") {
      if (offset > 0 && node.childNodes[offset - 1]) {
        var before = node.childNodes[offset - 1];
        if (closestImageBlock(before)) return closestImageBlock(before);
        if (!isIgnorableNode(before)) return null;
      }
      return closestImageBlock(previousMeaningfulNode(node));
    }
    if (offset < node.childNodes.length && node.childNodes[offset]) {
      var after = node.childNodes[offset];
      if (closestImageBlock(after)) return closestImageBlock(after);
      if (!isIgnorableNode(after)) return null;
    }
    return closestImageBlock(nextMeaningfulNode(node));
  }

  function closestImageBlock(node) {
    if (!node) return null;
    if (node.nodeType === 1 && node.classList && node.classList.contains("image-block")) return node;
    if (node.nodeType === 1 && node.closest) return node.closest(".image-block");
    return null;
  }

  function previousMeaningfulNode(node) {
    while (node) {
      var previous = node.previousSibling;
      while (previous && isIgnorableNode(previous)) previous = previous.previousSibling;
      if (previous) return previous;
      node = node.parentNode;
      if (node && node.id === "editor") return null;
    }
    return null;
  }

  function nextMeaningfulNode(node) {
    while (node) {
      var next = node.nextSibling;
      while (next && isIgnorableNode(next)) next = next.nextSibling;
      if (next) return next;
      node = node.parentNode;
      if (node && node.id === "editor") return null;
    }
    return null;
  }

  function isIgnorableNode(node) {
    return node.nodeType === 3 && !node.nodeValue.trim();
  }

  async function insertImageFiles(files) {
    for (var i = 0; i < files.length; i += 1) {
      await insertImageFile(files[i]);
    }
  }

  async function pickAndInsertImage() {
    try {
      var selected = await pickNativeImage();
      if (!selected || !selected.dataUrl) return;
      var prepared = await preparePickedImage(selected.dataUrl, selected.mimeType || "image/jpeg");
      insertPreparedImage(prepared.dataUrl, selected.fileName || "diary-image.jpg", prepared.mimeType);
    } catch (error) {
      if (/cancel/i.test(error.message || "")) return;
      toast("选图失败：" + compactText(error.message, 70));
    }
  }

  function pickNativeImage() {
    return new Promise(function (resolve, reject) {
      if (!window.NideRijiLite || !window.NideRijiLite.pickImageAsync) {
        reject(new Error("当前 APK 未包含原生选图桥"));
        return;
      }
      var callbackId = "pick_" + Date.now() + "_" + Math.random().toString(16).slice(2);
      callbacks[callbackId] = {
        resolve: function (response) {
          if (response && response.ok) {
            resolve(response);
            return;
          }
          reject(new Error((response && (response.error || response.body)) || "选图失败"));
        },
        reject: reject
      };
      window.NideRijiLite.pickImageAsync(callbackId);
      setTimeout(function () {
        if (!callbacks[callbackId]) return;
        delete callbacks[callbackId];
        reject(new Error("选图超时"));
      }, 60000);
    });
  }

  async function insertImageFile(file) {
    if (!state.token) {
      toast("先登录后可以插入图片");
      state.tab = "profile";
      render();
      return;
    }
    if (!file || !/^image\//i.test(file.type || "")) {
      toast("请选择图片文件");
      return;
    }
    try {
      var prepared = await prepareImageFile(file);
      insertPreparedImage(prepared.dataUrl, file.name, prepared.mimeType);
    } catch (error) {
      toast("插入图片失败：" + compactText(error.message, 60));
    }
  }

  function insertPreparedImage(dataUrl, fileName, mimeType) {
    var localId = insertImageBlock(dataUrl, fileName, mimeType);
    if (!localId) return;
    uploadDraftImage(localId, dataUrl, fileName, mimeType);
  }

  function preparePickedImage(dataUrl, mimeType) {
    if ((mimeType || "").toLowerCase() === "image/gif") {
      return Promise.resolve({ dataUrl: dataUrl, mimeType: mimeType || "image/gif" });
    }
    return resizeImage(dataUrl, mimeType || "image/jpeg").catch(function () {
      return { dataUrl: dataUrl, mimeType: mimeType || "image/jpeg" };
    });
  }

  function insertImageBlock(dataUrl, fileName, mimeType) {
    var editor = document.getElementById("editor");
    if (!editor) return "";
    var localId = "img_" + Date.now() + "_" + Math.random().toString(16).slice(2);
    var figure = document.createElement("figure");
    figure.className = "image-block";
    figure.setAttribute("contenteditable", "false");
    figure.dataset.localId = localId;
    figure.dataset.uploadState = "uploading";
    figure.dataset.fileName = fileName || "diary-image.jpg";
    figure.dataset.mime = mimeType || "image/jpeg";

    var frame = document.createElement("div");
    frame.className = "image-frame";
    var image = document.createElement("img");
    image.src = dataUrl;
    image.alt = "日记图片";
    frame.appendChild(image);
    figure.appendChild(frame);

    var caption = document.createElement("figcaption");
    caption.innerHTML = '<span class="image-status">上传中</span><button class="image-action" data-image-action="remove" type="button" aria-label="删除图片">' + icon("close") + "</button>";
    figure.appendChild(caption);

    var paragraph = createBlankParagraph();
    insertNodesAtSelection(editor, [figure, paragraph]);
    placeCaretInside(paragraph);
    syncEditorDraft();
    updateSaveState();
    return localId;
  }

  function bindEditorImageControls(editor) {
    editor.addEventListener("pointerdown", function (event) {
      var button = event.target.closest && event.target.closest("[data-image-action]");
      if (button) event.preventDefault();
    });
    editor.addEventListener("click", function (event) {
      var button = event.target.closest && event.target.closest("[data-image-action]");
      if (!button) return;
      event.preventDefault();
      var block = button.closest(".image-block");
      if (!block) return;
      if (button.dataset.imageAction === "remove") {
        var caretTarget = ensureTextBlockAfter(block);
        block.remove();
        placeCaretInside(caretTarget);
        syncEditorDraft();
      }
      if (button.dataset.imageAction === "retry") {
        var image = block.querySelector("img");
        if (!image) return;
        uploadDraftImage(block.dataset.localId, image.src, block.dataset.fileName || "diary-image.jpg", block.dataset.mime || "image/jpeg");
      }
    });
  }

  function rememberEditorRange() {
    var editor = document.getElementById("editor");
    var selection = window.getSelection && window.getSelection();
    if (!editor || !selection || !selection.rangeCount) return;
    var range = selection.getRangeAt(0);
    if (editor.contains(range.startContainer) && editor.contains(range.endContainer)) {
      lastEditorRange = range.cloneRange();
    }
  }

  function restoreEditorRange(editor) {
    var selection = window.getSelection && window.getSelection();
    if (!selection) return;
    editor.focus();
    selection.removeAllRanges();
    if (lastEditorRange && editor.contains(lastEditorRange.startContainer)) {
      selection.addRange(lastEditorRange);
      return;
    }
    var range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.addRange(range);
  }

  function insertEditorHtml(editor, html) {
    restoreEditorRange(editor);
    var box = document.createElement("div");
    box.innerHTML = html;
    var nodes = Array.prototype.slice.call(box.childNodes);
    if (!nodes.length) return;
    insertNodesAtSelection(editor, nodes);
  }

  function insertNodesAtSelection(editor, nodes) {
    restoreEditorRange(editor);
    var selection = window.getSelection && window.getSelection();
    if (!selection || !selection.rangeCount) return;
    var range = selection.getRangeAt(0);
    range.deleteContents();
    var fragment = document.createDocumentFragment();
    nodes.forEach(function (node) {
      fragment.appendChild(node);
    });
    var last = nodes[nodes.length - 1];
    range.insertNode(fragment);
    if (last) placeCaretAfterNode(last);
    rememberEditorRange();
    updateEditorEmptyState(editor);
  }

  function createBlankParagraph() {
    var paragraph = document.createElement("p");
    paragraph.appendChild(document.createElement("br"));
    return paragraph;
  }

  function isEditableTextBlock(node) {
    return !!(node && node.nodeType === 1 && /^(P|DIV)$/.test(node.tagName) && !node.classList.contains("image-block"));
  }

  function ensureTextBlockAfter(node) {
    var next = node && node.nextElementSibling;
    if (isEditableTextBlock(next)) return next;
    var paragraph = createBlankParagraph();
    if (node && node.parentNode) node.parentNode.insertBefore(paragraph, node.nextSibling);
    return paragraph;
  }

  function ensureTextBlockBefore(node) {
    var previous = node && node.previousElementSibling;
    if (isEditableTextBlock(previous)) return previous;
    var paragraph = createBlankParagraph();
    if (node && node.parentNode) node.parentNode.insertBefore(paragraph, node);
    return paragraph;
  }

  function placeCaretInside(node) {
    var selection = window.getSelection && window.getSelection();
    if (!selection || !node) return;
    node.focus && node.focus();
    var range = document.createRange();
    range.setStart(node, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    rememberEditorRange();
    keepCaretVisible();
  }

  function placeCaretAfterNode(node) {
    var selection = window.getSelection && window.getSelection();
    if (!selection || !node || !node.parentNode) return;
    var range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    rememberEditorRange();
  }

  function placeCaretAtEnd(node) {
    var selection = window.getSelection && window.getSelection();
    if (!selection || !node) return;
    var range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    rememberEditorRange();
    keepCaretVisible();
  }

  function updateEditorEmptyState(editor) {
    if (!editor) return;
    var hasImages = !!editor.querySelector(".image-block, img");
    var text = (editor.innerText || editor.textContent || "").replace(/\u00a0/g, " ").trim();
    editor.classList.toggle("is-empty", !hasImages && !text);
  }

  function editorMetrics(editor) {
    if (!editor) return { chars: 0, images: 0, uploading: 0, failed: 0 };
    var clone = editor.cloneNode(true);
    clone.querySelectorAll("figcaption, .image-action, .image-status").forEach(function (node) {
      node.remove();
    });
    return {
      chars: (clone.innerText || clone.textContent || "").replace(/\s/g, "").length,
      images: editor.querySelectorAll(".image-block, img[data-image-id]").length,
      uploading: editor.querySelectorAll(".image-block[data-upload-state='uploading']").length,
      failed: editor.querySelectorAll(".image-block[data-upload-state='failed']").length
    };
  }

  function keepCaretVisible() {
    var selection = window.getSelection && window.getSelection();
    if (!selection || !selection.rangeCount) return;
    setTimeout(function () {
      var active = document.activeElement;
      if (!active || active.id !== "editor") return;
      var range = selection.rangeCount ? selection.getRangeAt(0) : null;
      if (!range || !range.getBoundingClientRect) return;
      var rect = range.getBoundingClientRect();
      if (!rect || (!rect.top && !rect.bottom)) return;
      var viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      var lowerEdge = viewportHeight - 96;
      if (rect.bottom > lowerEdge || rect.top < 72) {
        active.scrollIntoView({ block: "nearest" });
      }
    }, 40);
  }

  function syncEditorDraft() {
    var editor = document.getElementById("editor");
    if (!editor) return;
    updateEditorEmptyState(editor);
    state.draftHtml = sanitizeEditorHtml(editor.innerHTML);
    saveCurrentDraft(true);
    updateSaveState();
  }

  function editorStateText() {
    if (state.saving) return "保存中...";
    var editor = document.getElementById("editor");
    if (!editor) return "草稿保存在本机";
    var metrics = editorMetrics(editor);
    var base = metrics.chars + " 字";
    if (metrics.images) base += " · " + metrics.images + " 图";
    if (metrics.uploading) return base + " · 正在上传 " + metrics.uploading + " 张";
    if (metrics.failed) return base + " · " + metrics.failed + " 张上传失败";
    return base + " · 草稿已保存在本机";
  }

  function updateSaveState() {
    var node = document.getElementById("save-state");
    if (node) node.textContent = editorStateText();
    var button = document.querySelector("[data-action='save']");
    var editor = document.getElementById("editor");
    if (button && editor) {
      var metrics = editorMetrics(editor);
      button.disabled = !!(state.saving || metrics.uploading || metrics.failed);
    }
  }

  function hasUploadingImages() {
    var editor = document.getElementById("editor");
    return !!(editor && editor.querySelector(".image-block[data-upload-state='uploading']"));
  }

  function hasBrokenImages() {
    var editor = document.getElementById("editor");
    if (!editor) return false;
    return !!editor.querySelector(".image-block[data-upload-state='failed'], .image-block:not([data-image-id])");
  }

  function prepareImageFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("读取图片失败")); };
      reader.onload = function () {
        var source = String(reader.result || "");
        if ((file.type || "").toLowerCase() === "image/gif") {
          resolve({ dataUrl: source, mimeType: file.type || "image/gif" });
          return;
        }
        resizeImage(source, file.type || "image/jpeg").then(resolve).catch(function () {
          resolve({ dataUrl: source, mimeType: file.type || "image/jpeg" });
        });
      };
      reader.readAsDataURL(file);
    });
  }

  function resizeImage(dataUrl, mimeType) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () {
        var maxSide = 1280;
        var width = image.naturalWidth || image.width;
        var height = image.naturalHeight || image.height;
        if (!width || !height) {
          reject(new Error("图片尺寸异常"));
          return;
        }
        var scale = Math.min(1, maxSide / Math.max(width, height));
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        var ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        var targetMime = mimeType === "image/png" ? "image/png" : "image/jpeg";
        var quality = targetMime === "image/png" ? undefined : 0.84;
        var output = targetMime === "image/png" ? canvas.toDataURL(targetMime) : canvas.toDataURL(targetMime, quality);
        while (targetMime !== "image/png" && dataUrlBytes(output) > 1572864 && quality > 0.68) {
          quality -= 0.08;
          output = canvas.toDataURL(targetMime, quality);
        }
        resolve({ dataUrl: output, mimeType: targetMime });
      };
      image.onerror = function () { reject(new Error("图片解析失败")); };
      image.src = dataUrl;
    });
  }

  function dataUrlBytes(dataUrl) {
    var comma = String(dataUrl || "").indexOf(",");
    var payload = comma >= 0 ? String(dataUrl || "").slice(comma + 1) : String(dataUrl || "");
    return Math.ceil(payload.length * 3 / 4);
  }

  async function uploadDraftImage(localId, dataUrl, fileName, mimeType) {
    var block = getImageBlock(localId);
    setImageBlockState(block, "uploading", "上传中");
    try {
      var response = await uploadOfficialImage(dataUrl, fileName, mimeType);
      if (!response.ok) {
        throw new Error(apiErrorMessage(response.uploadPath || "/api/upload_image", response));
      }
      var data = JSON.parse(response.body || "{}");
      var imageId = findImageId(data);
      if (!imageId) {
        throw new Error("上传成功但没有 image_id");
      }
      block = getImageBlock(localId);
      if (!block) return;
      block.dataset.uploadState = "done";
      block.dataset.imageId = String(imageId);
      block.dataset.imageToken = "[图" + imageId + "]";
      block.dataset.userId = currentUserId();
      var uploadedImage = block.querySelector("img");
      if (uploadedImage) {
        uploadedImage.dataset.imageId = String(imageId);
        uploadedImage.dataset.userId = currentUserId();
      }
      var status = block.querySelector(".image-status");
      if (status) status.textContent = "已上传";
      syncEditorDraft();
    } catch (error) {
      block = getImageBlock(localId);
      setImageBlockState(block, "failed", "上传失败：" + compactText(error.message, 90), true);
      toast("图片上传失败：" + compactText(error.message, 90));
      syncEditorDraft();
    }
  }

  function uploadOfficialImage(dataUrl, fileName, mimeType) {
    return new Promise(function (resolve, reject) {
      if (!window.NideRijiLite || !window.NideRijiLite.uploadImageAsync) {
        reject(new Error("当前 APK 未包含图片上传桥"));
        return;
      }
      var callbackId = "up_" + Date.now() + "_" + Math.random().toString(16).slice(2);
      callbacks[callbackId] = { resolve: resolve, reject: reject };
      window.NideRijiLite.uploadImageAsync(callbackId, state.token || "", dataUrl, fileName || "diary-image.jpg", mimeType || "image/jpeg");
      setTimeout(function () {
        if (!callbacks[callbackId]) return;
        delete callbacks[callbackId];
        reject(new Error("图片上传超时"));
      }, 60000);
    });
  }

  function getImageBlock(localId) {
    return document.querySelector(".image-block[data-local-id='" + cssEscape(localId) + "']");
  }

  function setImageBlockState(block, stateName, label, canRetry) {
    if (!block) return;
    block.dataset.uploadState = stateName;
    var caption = block.querySelector("figcaption");
    if (!caption) return;
    caption.innerHTML = [
      '<span class="image-status">' + escapeHtml(label) + "</span>",
      canRetry ? '<button class="image-action" data-image-action="retry" type="button">重试</button>' : "",
      '<button class="image-action" data-image-action="remove" type="button" aria-label="删除图片">' + icon("close") + "</button>"
    ].join("");
    updateSaveState();
  }

  function findImageId(value) {
    if (!value || typeof value !== "object") return "";
    var keys = ["image_id", "imageId", "id"];
    for (var i = 0; i < keys.length; i += 1) {
      if (value[keys[i]] != null && String(value[keys[i]]).match(/^\d+$/)) {
        return String(value[keys[i]]);
      }
    }
    for (var key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      var found = findImageId(value[key]);
      if (found) return found;
    }
    return "";
  }

  function bindPageActions() {
    view.querySelectorAll("[data-action]").forEach(function (button) {
      button.addEventListener("click", function () {
        var action = button.dataset.action;
        if (action === "sync") syncAll(true);
        if (action === "save") saveDiary();
        if (action === "clear-draft") clearDraft();
        if (action === "preview") previewDraft();
        if (action === "timeline") {
          state.tab = "timeline";
          persistSettings();
          render();
        }
      });
    });
  }

  function clearDraft() {
    clearDraftV2();
    return;
    state.draftTitle = "";
    state.draftHtml = "";
    persistSettings();
    renderWrite();
  }

  function previewDraft() {
    previewDraftV2();
    return;
    openDiaryModal({
      owner: state.draftOwner,
      ownerLabel: ownerLabel(state.draftOwner),
      title: state.draftTitle || "未命名日记",
      createddate: todayStamp(),
      weekday: weekdayText(new Date()),
      html: editorHtmlToPreviewHtml(state.draftHtml) || "<p>还没有内容。</p>"
    }, true);
  }

  async function saveDiary() {
    return saveDiaryV2();
    if (!state.token) {
      toast("先到个人页登录或粘贴 token");
      state.tab = "profile";
      render();
      return;
    }
    syncEditorDraft();
    if (hasUploadingImages()) {
      toast("等图片上传完成后再保存");
      return;
    }
    if (hasBrokenImages()) {
      toast("有图片还没上传成功，请重试或删除");
      return;
    }
    var html = state.draftHtml.trim();
    var text = "";
    try {
      text = htmlToOfficialContent(html);
    } catch (error) {
      toast(error.message);
      return;
    }
    if (!text) {
      toast("写一点内容再保存");
      return;
    }
    state.saving = true;
    renderWrite();
    try {
      var payload = {
        title: state.draftTitle || "",
        content: text,
        createddate: todayStamp(),
        diary_date: todayStamp(),
        is_public: "0",
        weather: "",
        mood: ""
      };
      var response = await postApi("/api/write/", payload);
      if (!response || response.error || response.detail) {
        throw new Error(JSON.stringify(response));
      }
      toast("已提交保存");
      clearDraft();
      await syncAll(false);
    } catch (error) {
      toast("保存失败，接口字段可能需要再对：" + error.message.slice(0, 60));
    } finally {
      state.saving = false;
      renderWrite();
    }
  }

  function clearDraftV2() {
    var existing = findMyDiaryForDate(state.draftDate);
    state.draftTitle = "";
    state.draftHtml = "";
    state.draftDiaryId = state.draftDiaryId || (existing && existing.id ? String(existing.id) : "");
    state.draftsByDate[state.draftDate] = {
      title: "",
      html: "",
      diaryId: state.draftDiaryId || "",
      dirty: true,
      cleared: true,
      updatedAt: Date.now()
    };
    persistSettings();
    renderWrite();
  }

  function previewDraftV2() {
    var previewDate = dateFromKey(state.draftDate);
    openDiaryModal({
      owner: "me",
      ownerLabel: ownerLabel("me"),
      title: state.draftTitle || "未命名日记",
      createddate: state.draftDate,
      weekday: weekdayText(previewDate),
      html: editorHtmlToPreviewHtml(state.draftHtml) || "<p>还没有内容。</p>"
    }, true);
  }

  async function saveDiaryV2() {
    if (!state.token) {
      toast("先到个人页登录或粘贴 token");
      state.tab = "profile";
      render();
      return;
    }
    syncEditorDraft();
    if (hasUploadingImages()) {
      toast("等图片上传完成后再保存");
      return;
    }
    if (hasBrokenImages()) {
      toast("有图片还没有上传成功，请重试或删除");
      return;
    }
    var html = state.draftHtml.trim();
    var text = "";
    try {
      text = htmlToOfficialContent(html);
    } catch (error) {
      toast(error.message);
      return;
    }
    if (!text) {
      toast("写一点内容再保存");
      return;
    }
    var existing = findMyDiaryForDate(state.draftDate);
    var diaryId = state.draftDiaryId || (existing && existing.id ? String(existing.id) : "");
    var payload = {
      title: state.draftTitle || "",
      content: text,
      createddate: state.draftDate,
      diary_date: state.draftDate,
      is_public: "0",
      weather: "",
      mood: ""
    };
    state.saving = true;
    renderWrite();
    try {
      if (diaryId) {
        try {
          await updateExistingDiary(diaryId, payload);
        } catch (updateError) {
          var ok = window.confirm("这一天已经有一篇日记。没有确认到官方更新接口，是否删除旧日记并保存当前内容？");
          if (!ok) throw updateError;
          await replaceExistingDiary(diaryId, payload, updateError);
        }
      } else {
        await writeNewDiary(payload);
      }
      var savedDate = state.draftDate;
      delete state.draftsByDate[savedDate];
      state.replaceBackup = null;
      state.draftTitle = "";
      state.draftHtml = "";
      state.draftDiaryId = "";
      loadedDraftDate = "";
      persistSettings();
      toast("已保存");
      await syncAll(false);
      state.draftDate = savedDate;
      loadedDraftDate = "";
      loadDraftForDate(savedDate);
    } catch (error) {
      toast("保存失败：" + compactText(error.message, 90));
    } finally {
      state.saving = false;
      renderWrite();
    }
  }

  async function writeNewDiary(payload) {
    var response = await postApi("/api/write/", payload);
    if (!response || response.error || response.detail) {
      throw new Error(JSON.stringify(response));
    }
    return response;
  }

  async function updateExistingDiary(diaryId, payload) {
    var data = Object.assign({}, payload, {
      id: diaryId,
      diary_id: diaryId,
      diaryid: diaryId
    });
    var paths = [
      "/api/diary/update/",
      "/api/diary/update",
      "/api/diary/edit/",
      "/api/diary/edit",
      "/api/update_diary/",
      "/api/update_diary"
    ];
    var errors = [];
    for (var i = 0; i < paths.length; i += 1) {
      try {
        return await postApi(paths[i], data);
      } catch (error) {
        errors.push(paths[i] + " " + compactText(error.message, 80));
      }
    }
    throw new Error(errors.join(" | "));
  }

  async function replaceExistingDiary(diaryId, payload, updateError) {
    state.replaceBackup = {
      diaryId: diaryId,
      date: state.draftDate,
      title: state.draftTitle || "",
      html: state.draftHtml || "",
      content: payload.content || "",
      updateError: updateError ? compactText(updateError.message, 180) : "",
      createdAt: new Date().toISOString()
    };
    persistSettings();
    await deleteDiaryById(diaryId);
    return writeNewDiary(payload);
  }

  async function deleteDiaryById(diaryId) {
    var paths = ["/api/diary/delete", "/api/diary/delete/"];
    var payloads = [
      { diary_id: diaryId },
      { diaryid: diaryId },
      { id: diaryId },
      { diary_ids: diaryId }
    ];
    var errors = [];
    for (var i = 0; i < paths.length; i += 1) {
      for (var j = 0; j < payloads.length; j += 1) {
        try {
          return await postApi(paths[i], payloads[j]);
        } catch (error) {
          errors.push(paths[i] + " " + compactText(error.message, 80));
        }
      }
    }
    throw new Error("删除旧日记失败：" + errors.join(" | "));
  }

  function renderTimeline() {
    var filtered = filteredDiaries();
    var isCalendar = state.timelineView === "calendar";
    view.innerHTML = [
      '<section class="page timeline-page">',
      '<div class="timeline-tools">',
      '<input class="search-input" id="search" type="search" placeholder="搜索双方全文" value="' + escapeAttr(state.query) + '">',
      '<button class="ghost-btn" data-action="sync" type="button">' + icon("refresh") + "<span>同步</span></button>",
      "</div>",
      '<div class="timeline-control-row">',
      '<div class="segmented">',
      scopeButton("both", "双方"),
      scopeButton("me", "我"),
      scopeButton("paired", "对方"),
      "</div>",
      '<div class="view-toggle">',
      viewButton("timeline", "时间线"),
      viewButton("calendar", "日历"),
      "</div>",
      "</div>",
      filtered.length ? (isCalendar ? calendarHtml(filtered) : '<div class="timeline">' + filtered.map(timelineItemHtml).join("") + "</div>") : emptyHtml(state.token ? "没有日记。点同步试试。" : "先到个人页登录，然后同步双方日记。"),
      "</section>"
    ].join("");
    view.querySelector("#search").addEventListener("input", function (event) {
      state.query = event.target.value;
      persistSettings();
      renderTimeline();
    });
    document.querySelectorAll("[data-scope]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.scope = button.dataset.scope;
        persistSettings();
        renderTimeline();
      });
    });
    view.querySelectorAll("[data-view]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.timelineView = button.dataset.view;
        persistSettings();
        renderTimeline();
      });
    });
    view.querySelectorAll("[data-calendar-step]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.calendarMonth = shiftMonth(calendarMonthKey(filtered), Number(button.dataset.calendarStep));
        persistSettings();
        renderTimeline();
      });
    });
    view.querySelectorAll("[data-calendar-day]").forEach(function (button) {
      button.addEventListener("click", function () {
        var items = diariesOnDate(filtered, button.dataset.calendarDay);
        if (items.length) openDayModal(button.dataset.calendarDay, items);
      });
    });
    view.querySelectorAll("[data-action='sync']").forEach(function (button) {
      button.addEventListener("click", function () { syncAll(true); });
    });
    view.querySelectorAll("[data-diary]").forEach(function (button) {
      button.addEventListener("click", function () {
        var diary = state.diaries.find(function (item) {
          return item.key === button.dataset.diary;
        });
        if (diary) openDiaryModal(diary, false);
      });
    });
  }

  function scopeButton(scope, label) {
    return '<button type="button" data-scope="' + scope + '" class="' + (state.scope === scope ? "is-active" : "") + '">' + label + "</button>";
  }

  function viewButton(viewName, label) {
    return '<button type="button" data-view="' + viewName + '" class="' + (state.timelineView === viewName ? "is-active" : "") + '">' + label + "</button>";
  }

  function filteredDiaries() {
    var query = state.query.trim().toLowerCase();
    return state.diaries.filter(function (item) {
      if (state.scope !== "both" && item.owner !== state.scope) return false;
      if (!query) return true;
      return [item.title, item.text, item.createddate, item.weekday].join("\n").toLowerCase().indexOf(query) !== -1;
    }).sort(function (a, b) {
      return String(b.createddate || "").localeCompare(String(a.createddate || ""));
    });
  }

  function timelineItemHtml(item, index) {
    return timelineItemHtmlV2(item, index);
    var preview = item.text || stripHtml(item.html || "");
    var card = [
      '<button class="timeline-card" type="button" data-diary="' + escapeAttr(item.key) + '">',
      '<div class="diary-meta"><span>' + escapeHtml(item.createddate || "无日期") + '</span><span class="owner-badge">' + ownerLabel(item.owner) + "</span></div>",
      '<h3>' + escapeHtml(item.title || "未命名") + "</h3>",
      '<p>' + escapeHtml(preview || "没有文字内容") + "</p>",
      "</button>"
    ].join("");
    return [
      '<div class="timeline-row" data-owner="' + item.owner + '" style="animation-delay:' + Math.min(index * 28, 240) + 'ms">',
      '<div class="timeline-side timeline-left">' + (item.owner === "me" ? card : "") + "</div>",
      '<div class="timeline-spine"><span class="timeline-dot"></span></div>',
      '<div class="timeline-side timeline-right">' + (item.owner === "paired" ? card : "") + "</div>",
      "</div>"
    ].join("");
  }

  function timelineItemHtmlV2(item, index) {
    var preview = item.text || stripHtml(item.html || "");
    var unread = isUnreadPairedDiary(item);
    var card = [
      '<button class="timeline-card' + (unread ? " is-unread" : "") + '" type="button" data-diary="' + escapeAttr(item.key) + '">',
      '<div class="diary-meta"><span>' + escapeHtml(item.createddate || "") + '</span><span class="owner-badge">' + ownerLabel(item.owner) + "</span></div>",
      unread ? '<span class="unread-badge">NEW</span>' : "",
      '<h3>' + escapeHtml(item.title || "未命名") + "</h3>",
      '<p>' + escapeHtml(preview || "没有文字内容") + "</p>",
      "</button>"
    ].join("");
    return [
      '<div class="timeline-row" data-owner="' + item.owner + '" data-unread="' + (unread ? "true" : "false") + '" style="animation-delay:' + Math.min(index * 28, 240) + 'ms">',
      '<div class="timeline-side timeline-left">' + (item.owner === "me" ? card : "") + "</div>",
      '<div class="timeline-spine"><span class="timeline-dot"></span></div>',
      '<div class="timeline-side timeline-right">' + (item.owner === "paired" ? card : "") + "</div>",
      "</div>"
    ].join("");
  }

  function calendarHtml(items) {
    var monthKey = calendarMonthKey(items);
    var cells = calendarCells(monthKey);
    return [
      '<section class="calendar-view">',
      '<div class="calendar-head">',
      '<button class="icon-btn" data-calendar-step="-1" type="button" aria-label="上个月">' + icon("chevronLeft") + "</button>",
      '<strong>' + escapeHtml(monthTitle(monthKey)) + "</strong>",
      '<button class="icon-btn" data-calendar-step="1" type="button" aria-label="下个月">' + icon("chevronRight") + "</button>",
      "</div>",
      '<div class="calendar-weekdays">' + ["日", "一", "二", "三", "四", "五", "六"].map(function (day) { return "<span>" + day + "</span>"; }).join("") + "</div>",
      '<div class="calendar-grid">' + cells.map(function (date) { return calendarDayHtml(date, items); }).join("") + "</div>",
      "</section>"
    ].join("");
  }

  function calendarDayHtml(date, items) {
    if (!date) return '<div class="calendar-cell is-empty"></div>';
    var dayItems = diariesOnDate(items, date);
    var owners = {};
    dayItems.forEach(function (item) { owners[item.owner] = true; });
    return [
      '<button class="calendar-cell' + (date === todayStamp() ? " is-today" : "") + (dayItems.length ? " has-diary" : "") + '" type="button" data-calendar-day="' + escapeAttr(date) + '">',
      '<span class="calendar-day-num">' + Number(date.slice(8, 10)) + "</span>",
      '<span class="calendar-dots">',
      owners.me ? '<i style="background:var(--me)"></i>' : "",
      owners.paired ? '<i style="background:var(--paired)"></i>' : "",
      "</span>",
      "</button>"
    ].join("");
  }

  function calendarMonthKey(items) {
    if (/^\d{4}-\d{2}$/.test(state.calendarMonth || "")) return state.calendarMonth;
    var first = items.map(function (item) { return dateKey(item.createddate); }).filter(Boolean)[0];
    return (first || todayStamp()).slice(0, 7);
  }

  function calendarCells(monthKey) {
    var parts = monthKey.split("-");
    var year = Number(parts[0]);
    var month = Number(parts[1]) - 1;
    var first = new Date(year, month, 1);
    var total = new Date(year, month + 1, 0).getDate();
    var cells = [];
    for (var i = 0; i < first.getDay(); i += 1) cells.push("");
    for (var day = 1; day <= total; day += 1) {
      cells.push(year + "-" + pad(month + 1) + "-" + pad(day));
    }
    while (cells.length % 7) cells.push("");
    return cells;
  }

  function shiftMonth(monthKey, step) {
    var parts = monthKey.split("-");
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1 + step, 1);
    return date.getFullYear() + "-" + pad(date.getMonth() + 1);
  }

  function monthTitle(monthKey) {
    var parts = monthKey.split("-");
    return Number(parts[0]) + "年" + Number(parts[1]) + "月";
  }

  function diariesOnDate(items, date) {
    return items.filter(function (item) { return dateKey(item.createddate) === date; });
  }

  function dateKey(value) {
    var match = String(value || "").match(/\d{4}-\d{1,2}-\d{1,2}/);
    if (!match) return "";
    var parts = match[0].split("-");
    return parts[0] + "-" + pad(parts[1]) + "-" + pad(parts[2]);
  }

  function openDayModal(date, items) {
    var root = document.getElementById("modal-root");
    root.innerHTML = [
      '<div class="modal-backdrop day-backdrop">',
      '<article class="modal day-sheet">',
      '<header class="day-sheet-head">',
      '<div><div class="eyebrow">' + escapeHtml(date) + '</div><h2>当天日记</h2></div>',
      '<button class="icon-btn" data-close type="button" aria-label="关闭">' + icon("close") + "</button>",
      "</header>",
      '<div class="day-diary-list">' + items.map(dayDiaryHtml).join("") + "</div>",
      "</article>",
      "</div>"
    ].join("");
    root.querySelector("[data-close]").addEventListener("click", closeModal);
    root.querySelector(".modal-backdrop").addEventListener("click", function (event) {
      if (event.target.classList.contains("modal-backdrop")) closeModal();
    });
    root.querySelectorAll("[data-day-diary]").forEach(function (button) {
      button.addEventListener("click", function () {
        var diary = items.find(function (item) { return item.key === button.dataset.dayDiary; });
        if (diary) openDiaryModal(diary, false);
      });
    });
  }

  function dayDiaryHtml(item) {
    return dayDiaryHtmlV2(item);
    var preview = item.text || stripHtml(item.html || "");
    return [
      '<button class="day-diary-card" data-owner="' + item.owner + '" data-day-diary="' + escapeAttr(item.key) + '" type="button">',
      '<span class="owner-badge">' + ownerLabel(item.owner) + "</span>",
      '<strong>' + escapeHtml(item.title || "未命名") + "</strong>",
      '<span>' + escapeHtml(preview || "没有文字内容") + "</span>",
      "</button>"
    ].join("");
  }

  function dayDiaryHtmlV2(item) {
    var preview = item.text || stripHtml(item.html || "");
    var unread = isUnreadPairedDiary(item);
    return [
      '<button class="day-diary-card' + (unread ? " is-unread" : "") + '" data-owner="' + item.owner + '" data-day-diary="' + escapeAttr(item.key) + '" type="button">',
      '<span class="owner-badge">' + ownerLabel(item.owner) + "</span>",
      unread ? '<span class="unread-badge">NEW</span>' : "",
      '<strong>' + escapeHtml(item.title || "未命名") + "</strong>",
      '<span>' + escapeHtml(preview || "没有文字内容") + "</span>",
      "</button>"
    ].join("");
  }

  function seedReadDiaryKeysIfEmpty() {
    if (Object.keys(state.readDiaryKeys || {}).length) return;
    (state.diaries || []).forEach(function (item) {
      if (item && item.owner === "paired") {
        state.readDiaryKeys[item.key] = diaryReadSignature(item);
      }
    });
  }

  function diaryReadSignature(item) {
    if (!item) return "";
    return [
      item.id || item.key || "",
      dateKey(item.createddate) || item.createddate || "",
      item.title || "",
      item.content || item.text || stripHtml(item.html || "")
    ].join("|");
  }

  function isUnreadPairedDiary(item) {
    if (!item || item.owner !== "paired") return false;
    return state.readDiaryKeys[item.key] !== diaryReadSignature(item);
  }

  function markDiaryRead(item) {
    if (!item || item.owner !== "paired") return;
    state.readDiaryKeys[item.key] = diaryReadSignature(item);
    persistCache();
  }

  function renderProfile() {
    var meName = getUserName("me");
    var pairedName = getUserName("paired");
    view.innerHTML = [
      '<section class="page">',
      '<div class="profile-grid">',
      '<section class="profile-card profile-head">',
      '<div class="avatar-pair"><div class="avatar" style="background:var(--me)">我</div><div class="avatar" style="background:var(--paired)">TA</div></div>',
      '<div><h2 class="profile-title">' + escapeHtml(meName) + " / " + escapeHtml(pairedName) + '</h2><p class="profile-desc">' + escapeHtml(state.lastSyncText) + "</p>" + syncErrorHtml() + "</div>",
      "</section>",
      loginCardHtml(),
      colorCardHtml(),
      settingsCardHtml(),
      "</div>",
      "</section>"
    ].join("");
    bindProfileEvents();
  }

  function loginCardHtml() {
    return [
      '<section class="profile-card form-grid">',
      '<div class="field"><label>邮箱 / 用户名</label><input class="text-input" id="login-email" autocomplete="username"></div>',
      '<div class="field"><label>密码</label><input class="text-input" id="login-password" type="password" autocomplete="current-password"></div>',
      '<button class="solid-btn" data-profile-action="login" type="button">' + icon("login") + "<span>登录官方接口</span></button>",
      '<div class="field"><label>或粘贴 token</label><input class="text-input" id="token-input" value="' + escapeAttr(state.token) + '" placeholder="token"></div>',
      '<button class="ghost-btn" data-profile-action="save-token" type="button">保存 token</button>',
      "</section>"
    ].join("");
  }

  function syncErrorHtml() {
    if (!state.lastSyncError) return "";
    return '<div class="sync-debug">' + escapeHtml(state.lastSyncError) + "</div>";
  }

  function colorCardHtml() {
    return [
      '<section class="profile-card form-grid">',
      '<div class="color-field"><label>我的颜色</label><div class="color-row"><input class="text-input" id="me-color-text" value="' + escapeAttr(state.meColor) + '"><input id="me-color" type="color" value="' + escapeAttr(state.meColor) + '"></div></div>',
      '<div class="color-field"><label>对方颜色</label><div class="color-row"><input class="text-input" id="paired-color-text" value="' + escapeAttr(state.pairedColor) + '"><input id="paired-color" type="color" value="' + escapeAttr(state.pairedColor) + '"></div></div>',
      '<button class="solid-btn" data-profile-action="save-colors" type="button">应用颜色</button>',
      "</section>"
    ].join("");
  }

  function settingsCardHtml() {
    return [
      '<section class="profile-card menu-list">',
      menuItem("sync", "同步双方日记", "刷新时间线、图片索引和个人资料"),
      menuItem("role", "切换双方身份颜色", "本地显示设置，不影响官方数据"),
      menuItem("description", "签名 / 说明", "官方接口入口已预留，待确认字段"),
      menuItem("theme", "主题图", "官方会员主题图接口入口已预留"),
      menuItem("clear-cache", "清除本地缓存", "不会删除官方服务器数据"),
      "</section>"
    ].join("");
  }

  function menuItem(action, title, desc) {
    return '<button class="menu-item" data-profile-action="' + action + '" type="button"><span><strong>' + title + '</strong><br><span>' + desc + '</span></span><span>›</span></button>';
  }

  function bindProfileEvents() {
    document.querySelectorAll("[data-profile-action]").forEach(function (button) {
      button.addEventListener("click", async function () {
        var action = button.dataset.profileAction;
        if (action === "login") login();
        if (action === "save-token") saveToken();
        if (action === "save-colors") saveColors();
        if (action === "sync") syncAll(true);
        if (action === "role") swapColors();
        if (action === "description") toast("签名接口需要下一轮确认字段");
        if (action === "theme") toast("主题图接口需要下一轮确认字段");
        if (action === "clear-cache") clearCache();
      });
    });
    [["me-color", "me-color-text"], ["paired-color", "paired-color-text"]].forEach(function (pair) {
      var picker = document.getElementById(pair[0]);
      var text = document.getElementById(pair[1]);
      picker.addEventListener("input", function () { text.value = picker.value; });
      text.addEventListener("input", function () {
        if (/^#[0-9a-f]{6}$/i.test(text.value)) picker.value = text.value;
      });
    });
  }

  async function login() {
    var email = document.getElementById("login-email").value.trim();
    var password = document.getElementById("login-password").value;
    if (!email || !password) {
      toast("请输入账号和密码");
      return;
    }
    try {
      var data = await postApi("/api/login/", { email: email, password: password }, false);
      var token = findToken(data);
      if (!token) throw new Error(JSON.stringify(data).slice(0, 100));
      state.token = token;
      persistSettings();
      toast("登录成功，开始同步");
      await syncAll(true);
    } catch (error) {
      toast("登录失败：" + error.message.slice(0, 70));
    }
  }

  function saveToken() {
    state.token = document.getElementById("token-input").value.trim().replace(/^token\s+/i, "");
    persistSettings();
    toast(state.token ? "token 已保存" : "token 已清空");
  }

  function saveColors() {
    var me = document.getElementById("me-color-text").value.trim();
    var paired = document.getElementById("paired-color-text").value.trim();
    if (!/^#[0-9a-f]{6}$/i.test(me) || !/^#[0-9a-f]{6}$/i.test(paired)) {
      toast("颜色格式要像 #2f7d68");
      return;
    }
    state.meColor = me;
    state.pairedColor = paired;
    persistSettings();
    applyTheme();
    renderProfile();
  }

  function swapColors() {
    var next = state.meColor;
    state.meColor = state.pairedColor;
    state.pairedColor = next;
    persistSettings();
    renderProfile();
  }

  function clearCache() {
    state.sync = null;
    state.diaries = [];
    state.images = {};
    state.userConfig = null;
    state.lastSyncError = "";
    state.lastSyncText = "本地缓存已清除";
    persistCache();
    toast("已清除本地缓存");
    renderProfile();
  }

  async function syncAll(showToast) {
    if (!state.token) {
      if (showToast) toast("请先登录或粘贴 token");
      return;
    }
    if (state.tab === "write" && !state.saving) syncEditorDraft();
    if (state.syncing) return;
    state.syncing = true;
    state.lastSyncError = "";
    if (showToast) toast("正在同步...");
    try {
      var sync = unwrapApiData(await postApi("/api/v2/sync/", {
        user_config_ts: "0",
        diaries_ts: "0",
        readmark_ts: "0",
        images_ts: "0"
      }, true));
      if (!sync || typeof sync !== "object") {
        throw new Error("sync 返回为空");
      }
      state.sync = sync;
      state.userConfig = sync.user_config || null;
      indexImages(sync);
      var rows = collectOverview(sync);
      state.diaries = rows.map(function (item) {
        return normalizeDiary(item, item.overview || {});
      });
      state.lastSyncText = "已拿到列表 " + rows.length + " 篇，正在加载全文...";
      persistCache();
      if (state.tab === "timeline" || state.tab === "profile") render();
      var details = await fetchDetails(rows);
      state.diaries = details.length ? details : state.diaries;
      loadedDraftDate = "";
      state.lastSyncText = "已同步 " + details.length + " 篇 · " + timeText(new Date());
      persistCache();
      if (showToast) toast("同步完成");
      render();
    } catch (error) {
      state.lastSyncError = compactText(error.message, 220);
      state.lastSyncText = "同步失败 · " + timeText(new Date());
      persistCache();
      if (showToast) toast("同步失败：" + compactText(error.message, 70));
    } finally {
      state.syncing = false;
      if (state.tab === "timeline" || state.tab === "profile") render();
    }
  }

  function collectOverview(sync) {
    var config = sync.user_config || {};
    var selfUserId = config.userid;
    var pairedUserId = config.paired_user_config && config.paired_user_config.userid;
    var rows = [];
    (sync.diaries || []).forEach(function (item) {
      rows.push({ owner: "me", userId: selfUserId, id: item.id, overview: item });
    });
    (sync.diaries_paired || []).forEach(function (item) {
      rows.push({ owner: "paired", userId: pairedUserId, id: item.id, overview: item });
    });
    return rows.filter(function (item) { return item.userId && item.id; });
  }

  function indexImages(sync) {
    var config = sync.user_config || {};
    var selfUserId = config.userid;
    var pairedUserId = config.paired_user_config && config.paired_user_config.userid;
    var map = {};
    (sync.images || []).forEach(function (image) { map[String(image.image_id)] = selfUserId; });
    (sync.images_paired || []).forEach(function (image) { map[String(image.image_id)] = pairedUserId; });
    state.images = map;
  }

  async function fetchDetails(rows) {
    var result = new Array(rows.length);
    var cursor = 0;
    var workerCount = Math.min(5, rows.length);
    async function worker() {
      while (cursor < rows.length) {
        var index = cursor;
        cursor += 1;
        result[index] = await fetchOneDetail(rows[index]);
      }
    }
    var workers = [];
    for (var i = 0; i < workerCount; i += 1) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return result.filter(Boolean);
  }

  async function fetchOneDetail(item) {
    try {
      var data = await postApi("/api/diary/all_by_ids/" + encodeURIComponent(item.userId) + "/", {
        diary_ids: item.id
      }, true);
      var diary = data.diaries && data.diaries[0];
      if (diary) return normalizeDiary(item, diary);
    } catch (error) {
    }
    return normalizeDiary(item, item.overview || {});
  }

  function normalizeDiary(item, diary) {
    return normalizeDiaryV2(item, diary);
    var content = cleanUnicode(diary.content || "");
    return {
      key: item.owner + ":" + item.id,
      id: diary.id || item.id,
      owner: item.owner,
      ownerLabel: ownerLabel(item.owner),
      userId: item.userId,
      title: diary.title || item.overview.title || "",
      createddate: diary.createddate || item.overview.createddate || "",
      weekday: diary.weekday || item.overview.weekday || "",
      text: content.replace(/\[图\d+\]/g, "[图片]"),
      html: officialContentToHtml(content, item.userId)
    };
  }

  function normalizeDiaryV2(item, diary) {
    var content = cleanUnicode(diary.content || "");
    return {
      key: item.owner + ":" + item.id,
      id: diary.id || item.id,
      owner: item.owner,
      ownerLabel: ownerLabel(item.owner),
      userId: item.userId,
      title: diary.title || item.overview.title || "",
      createddate: diary.createddate || item.overview.createddate || "",
      weekday: diary.weekday || item.overview.weekday || "",
      content: content,
      text: content.replace(IMAGE_TOKEN_RE, "[图片]"),
      html: officialContentToHtml(content, item.userId)
    };
  }

  async function postApi(path, data, auth) {
    var headers = { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" };
    if (auth !== false && state.token) headers.auth = "token " + state.token;
    var response;
    try {
      response = await nativeRequest({
        url: API_ORIGIN + path,
        method: "POST",
        headers: headers,
        body: formEncode(data)
      });
    } catch (error) {
      throw new Error(path + " · " + compactText(error.message, 160));
    }
    try {
      if (!response.ok) {
        throw new Error(apiErrorMessage(path, response));
      }
      var parsed = JSON.parse(response.body || "{}");
      if (parsed && (parsed.error || parsed.detail)) {
        throw new Error(apiErrorMessage(path, response, compactText(JSON.stringify(parsed), 180)));
      }
      return parsed;
    } catch (error) {
      if (error.message && error.message.indexOf(path) !== -1) throw error;
      throw new Error(apiErrorMessage(path, response, "接口返回不是 JSON"));
    }
  }

  function nativeRequest(payload) {
    return new Promise(function (resolve, reject) {
      var callbackId = "cb_" + Date.now() + "_" + Math.random().toString(16).slice(2);
      callbacks[callbackId] = { resolve: resolve, reject: reject };
      if (!window.NideRijiLite || !window.NideRijiLite.requestAsync) {
        delete callbacks[callbackId];
        reject(new Error("Native bridge 未就绪"));
        return;
      }
      window.NideRijiLite.requestAsync(callbackId, JSON.stringify(payload));
      setTimeout(function () {
        if (!callbacks[callbackId]) return;
        delete callbacks[callbackId];
        reject(new Error("请求超时"));
      }, 45000);
    });
  }

  function loadImage(userId, imageId) {
    var key = IMAGE_CACHE_PREFIX + userId + "_" + imageId;
    var cached = sessionStorage.getItem(key);
    if (cached) return Promise.resolve(cached);
    return new Promise(function (resolve) {
      var callbackId = "img_" + Date.now() + "_" + Math.random().toString(16).slice(2);
      callbacks[callbackId] = {
        resolve: function (response) {
          if (response.ok && response.dataUrl) {
            sessionStorage.setItem(key, response.dataUrl);
            resolve(response.dataUrl);
          } else {
            resolve("");
          }
        },
        reject: function () { resolve(""); }
      };
      window.NideRijiLite.imageAsync(callbackId, state.token || "", userId || "", imageId || "");
    });
  }

  function openDiaryModal(item, isPreview) {
    if (!isPreview) markDiaryRead(item);
    var root = document.getElementById("modal-root");
    root.innerHTML = [
      '<div class="modal-backdrop detail-backdrop">',
      '<article class="modal detail-sheet detail-full">',
      '<header class="detail-hero" data-owner="' + item.owner + '">',
      '<div class="detail-title-row">',
      "<div>",
      '<div class="diary-meta"><span>' + escapeHtml(item.createddate || formatToday()) + '</span><span class="owner-badge">' + ownerLabel(item.owner) + "</span></div>",
      '<h2>' + escapeHtml(item.title || "未命名日记") + "</h2>",
      "</div>",
      '<button class="icon-btn" data-close type="button" aria-label="关闭">' + icon("close") + "</button>",
      "</div>",
      "</header>",
      '<div class="diary-body">' + (isPreview ? item.html : item.html || "") + "</div>",
      "</article>",
      "</div>"
    ].join("");
    root.querySelector("[data-close]").addEventListener("click", closeModal);
    root.querySelector(".modal-backdrop").addEventListener("click", function (event) {
      if (event.target.classList.contains("modal-backdrop")) closeModal();
    });
    hydrateDiaryImages(root);
  }

  function closeModal() {
    document.getElementById("modal-root").innerHTML = "";
    if (state.tab === "timeline") renderTimeline();
  }

  function hydrateDiaryImages(root) {
    root.querySelectorAll("img[data-image-id]").forEach(function (img) {
      loadImage(img.dataset.userId, img.dataset.imageId).then(function (src) {
        if (src) img.src = src;
      });
    });
  }

  function officialContentToHtml(text, userId) {
    return officialContentToHtmlV2(text, userId);
    return escapeHtml(text || "")
      .replace(/\n/g, "<br>")
      .replace(/\[图(\d+)\]/g, function (_, id) {
        var ownerId = userId || state.images[String(id)] || "";
        return '<img data-image-id="' + escapeAttr(id) + '" data-user-id="' + escapeAttr(ownerId) + '" alt="图' + id + '">';
      });
  }

  function officialContentToHtmlV2(text, userId) {
    return escapeHtml(text || "")
      .replace(/\n/g, "<br>")
      .replace(IMAGE_TOKEN_RE, function (_, id) {
        var ownerId = userId || state.images[String(id)] || "";
        return '<img data-image-id="' + escapeAttr(id) + '" data-user-id="' + escapeAttr(ownerId) + '" alt="图片' + escapeAttr(id) + '">';
      });
  }

  function htmlToOfficialContent(html) {
    return htmlToOfficialContentV2(html);
    var box = document.createElement("div");
    box.innerHTML = sanitizeEditorHtml(html);
    box.querySelectorAll("figcaption, .image-action, .image-status").forEach(function (node) {
      node.remove();
    });
    box.querySelectorAll(".image-block").forEach(function (block) {
      var imageId = block.dataset.imageId || "";
      if (!imageId) {
        var image = block.querySelector("img[data-image-id]");
        imageId = image ? image.dataset.imageId : "";
      }
      if (!imageId) throw new Error("有图片还没上传成功");
      block.parentNode.replaceChild(document.createTextNode("\n[图" + imageId + "]\n"), block);
    });
    box.querySelectorAll("img").forEach(function (img, index) {
      var imageId = img.dataset.imageId || "";
      var token = img.getAttribute("data-image-token") || (imageId ? "[图" + imageId + "]" : "");
      if (!token) throw new Error("第 " + (index + 1) + " 张图片还没上传成功");
      var replacement = document.createTextNode("\n" + token + "\n");
      img.parentNode.replaceChild(replacement, img);
    });
    box.querySelectorAll("br").forEach(function (br) {
      br.parentNode.replaceChild(document.createTextNode("\n"), br);
    });
    return (box.innerText || box.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function htmlToOfficialContentV2(html) {
    var box = document.createElement("div");
    box.innerHTML = sanitizeEditorHtml(html);
    box.querySelectorAll("figcaption, .image-action, .image-status").forEach(function (node) {
      node.remove();
    });
    box.querySelectorAll(".image-block").forEach(function (block) {
      var imageId = block.dataset.imageId || "";
      if (!imageId) {
        var image = block.querySelector("img[data-image-id]");
        imageId = image ? image.dataset.imageId : "";
      }
      if (!imageId) throw new Error("有图片还没有上传成功");
      block.parentNode.replaceChild(document.createTextNode("\n[图" + imageId + "]\n"), block);
    });
    box.querySelectorAll("img").forEach(function (img, index) {
      var imageId = img.dataset.imageId || "";
      var token = img.getAttribute("data-image-token") || (imageId ? "[图" + imageId + "]" : "");
      if (!token) throw new Error("第 " + (index + 1) + " 张图片还没有上传成功");
      img.parentNode.replaceChild(document.createTextNode("\n" + token + "\n"), img);
    });
    box.querySelectorAll("br").forEach(function (br) {
      br.parentNode.replaceChild(document.createTextNode("\n"), br);
    });
    return (box.innerText || box.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function editorHtmlToPreviewHtml(html) {
    var box = document.createElement("div");
    box.innerHTML = sanitizeEditorHtml(html || "");
    box.querySelectorAll(".image-block").forEach(function (block) {
      var image = block.querySelector("img");
      if (!image) {
        block.remove();
        return;
      }
      var cleanImage = document.createElement("img");
      cleanImage.src = image.src;
      cleanImage.alt = image.alt || "日记图片";
      if (block.dataset.imageId) cleanImage.dataset.imageId = block.dataset.imageId;
      if (block.dataset.userId || image.dataset.userId) cleanImage.dataset.userId = block.dataset.userId || image.dataset.userId;
      block.parentNode.replaceChild(cleanImage, block);
    });
    box.querySelectorAll("figcaption, .image-action, .image-status").forEach(function (node) {
      node.remove();
    });
    return box.innerHTML;
  }

  function sanitizeEditorHtml(html) {
    var box = document.createElement("div");
    box.innerHTML = html;
    box.querySelectorAll("script,style,iframe,object").forEach(function (node) { node.remove(); });
    box.querySelectorAll("*").forEach(function (node) {
      Array.prototype.slice.call(node.attributes).forEach(function (attr) {
        if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
      });
    });
    return box.innerHTML;
  }

  function formEncode(data) {
    return Object.keys(data || {}).map(function (key) {
      return encodeURIComponent(key) + "=" + encodeURIComponent(data[key] == null ? "" : data[key]);
    }).join("&");
  }

  function unwrapApiData(value) {
    if (value && typeof value === "object" && value.data && !value.user_config && !value.diaries) {
      return value.data;
    }
    return value;
  }

  function apiErrorMessage(path, response, fallback) {
    var parts = [response && response.uploadPath ? response.uploadPath : path];
    if (response && response.uploadField) parts.push("field=" + response.uploadField);
    if (response && response.status) parts.push("HTTP " + response.status);
    if (response && response.contentType) parts.push(response.contentType);
    var body = fallback || (response && (response.error || response.body)) || "";
    if (body) parts.push(compactText(body, 180));
    if (response && response.attempts && response.attempts.length) {
      var attempts = response.attempts.map(function (item) {
        return [item.uploadPath, item.uploadField, item.status || 0].filter(Boolean).join(":");
      }).join(", ");
      if (attempts) parts.push("attempts " + compactText(attempts, 180));
    }
    return parts.join(" · ");
  }

  function compactText(text, limit) {
    return String(text || "").replace(/\s+/g, " ").trim().slice(0, limit || 120);
  }

  function cssEscape(value) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(value);
    return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  function findToken(value) {
    if (!value || typeof value !== "object") return "";
    if (typeof value.token === "string") return value.token.replace(/^token\s+/i, "");
    if (typeof value.auth === "string") return value.auth.replace(/^token\s+/i, "");
    for (var key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      var found = findToken(value[key]);
      if (found) return found;
    }
    return "";
  }

  function getUserName(owner) {
    var config = state.userConfig || {};
    if (owner === "me") return config.nickname || config.name || config.email || "我";
    var paired = config.paired_user_config || {};
    return paired.nickname || paired.name || "对方";
  }

  function currentUserId() {
    var config = state.userConfig || {};
    return config.userid || config.user_id || "";
  }

  function ownerLabel(owner) {
    return owner === "paired" ? "对方" : "我";
  }

  function cleanUnicode(text) {
    return String(text || "").replace(/\\ud83c|\\ud83d|\\ud83e/g, "");
  }

  function stripHtml(html) {
    var box = document.createElement("div");
    box.innerHTML = html || "";
    return box.innerText || box.textContent || "";
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
    });
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  function todayStamp() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function formatToday() {
    var d = new Date();
    return todayStamp() + " " + weekdayText(d);
  }

  function weekdayText(date) {
    return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
  }

  function timeText(date) {
    return pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  function pad(num) {
    return String(num).padStart(2, "0");
  }

  function emptyHtml(text) {
    return '<div class="empty-state">' + escapeHtml(text) + "</div>";
  }

  function toast(message) {
    var existing = document.querySelector(".toast");
    if (existing) existing.remove();
    var node = document.createElement("div");
    node.className = "toast";
    node.textContent = message;
    document.body.appendChild(node);
    if (window.NideRijiLite && window.NideRijiLite.toast) {
      window.NideRijiLite.toast(message);
    }
    setTimeout(function () { node.remove(); }, 2800);
  }

  function icon(name) {
    var icons = {
      refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.4-4.8L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.4 4.8L20 16"/><path d="M20 20v-4h-4"/></svg>',
      calendar: '<svg viewBox="0 0 24 24"><path d="M8 2v4M16 2v4M3 10h18"/><rect x="3" y="4" width="18" height="18" rx="2"/></svg>',
      check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
      list: '<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>',
      image: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 15-5-5L5 19"/></svg>',
      quote: '<svg viewBox="0 0 24 24"><path d="M10 11H6a4 4 0 0 1 4-4v10H5V7"/><path d="M19 11h-4a4 4 0 0 1 4-4v10h-5V7"/></svg>',
      undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/></svg>',
      redo: '<svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h2"/></svg>',
      paragraph: '<svg viewBox="0 0 24 24"><path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/></svg>',
      chevronLeft: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
      chevronRight: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
      close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
      login: '<svg viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg>'
    };
    return icons[name] || "";
  }
})();
