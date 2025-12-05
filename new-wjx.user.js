// ==UserScript==
// @name         new-wjx 问卷星速填脚本
// @namespace    https://github.com/hungryM0/new-wjx
// @version      1.0
// @description  将原Selenium版核心功能迁移到浏览器的问卷星自动填写用户脚本
// @author       HUNGRY_M0
// @match        https://*.wjx.cn/*
// @match        https://*.wjx.top/*
// @match        https://wjx.cn/*
// @match        https://wjx.top/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '1.0';
  const CONFIG_STORAGE_KEY = '__new-wjx_config__';
  const RUN_STATE_KEY = '__new-wjx_runtime__';

  const QUESTION_TYPE_MAP = {
    '1': 'text',
    '2': 'text',
    '3': 'single',
    '4': 'multiple',
    '5': 'scale',
    '6': 'matrix',
    '7': 'dropdown',
    '8': 'slider',
    '11': 'reorder',
  };

  const QUESTION_TYPE_LABELS = {
    single: '单选题',
    multiple: '多选题',
    dropdown: '下拉题',
    matrix: '矩阵题',
    scale: '量表题',
    text: '填空题',
    slider: '滑块题',
    reorder: '排序题',
    location: '位置题',
  };

  const LNGLAT_PATTERN = /^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/;
  const MULTI_LIMIT_PATTERNS = [
    /最多(?:只能|可|可以)?(?:选|选择)?[^\d]{0,3}(\d+)/i,
    /(?:至多|不超过|限选)[^\d]{0,3}(\d+)/i,
    /(?:select|choose)\s+(?:up to|no more than|at most|a maximum of)\s*(\d+)/i,
    /(?:up to|no more than|at most|maximum of)\s*(\d+)\s*(?:options?|choices?|items?)/i,
    /(?:maximum|max)\s*(?:of\s*)?(\d+)\s*(?:options?|choices?)/i,
  ];
  const MULTI_LIMIT_KEYWORDS = [
    'max',
    'maxvalue',
    'maxcount',
    'maxchoice',
    'maxselect',
    'selectmax',
    'maxnum',
    'maxlimit',
    'data-max',
  ];

  const defaultConfig = () => ({
    version: SCRIPT_VERSION,
    url: window.location.href,
    targetNum: 1,
    submitInterval: { minSeconds: 0, maxSeconds: 0 },
    answerDurationRange: { minSeconds: 0, maxSeconds: 0 },
    questions: [],
  });

  const defaultRunState = () => ({
    active: false,
    target: 0,
    completed: 0,
    entryUrl: '',
    lastError: '',
  });

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const sleep = (ms) =>
    new Promise((resolve) => {
      window.setTimeout(resolve, Math.max(0, ms));
    });

  const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  const normalizeText = (value) => {
    if (value == null) return '';
    return String(value).replace(/\s+/g, ' ').trim();
  };

  const normalizeProbabilities = (values) => {
    const numbers = (values || []).map((value) => Number(value) || 0);
    const sum = numbers.reduce((total, value) => total + Math.max(value, 0), 0);
    if (!sum) {
      const fallback = numbers.length ? 1 / numbers.length : 0;
      return numbers.map(() => fallback);
    }
    return numbers.map((value) => Math.max(value, 0) / sum);
  };

  const weightedRandomIndex = (weights) => {
    if (!weights || !weights.length) return -1;
    const normalized = normalizeProbabilities(weights);
    const target = Math.random();
    let cumulative = 0;
    for (let i = 0; i < normalized.length; i += 1) {
      cumulative += normalized[i];
      if (target <= cumulative) {
        return i;
      }
    }
    return normalized.length - 1;
  };

  const parseJSONSafely = (text, fallback) => {
    if (!text) return fallback;
    try {
      return JSON.parse(text);
    } catch (err) {
      return fallback;
    }
  };

  class Logger {
    constructor() {
      this._subscribers = new Set();
      this._records = [];
      this._maxRecords = 500;
    }

    subscribe(handler) {
      if (typeof handler === 'function') {
        this._subscribers.add(handler);
      }
    }

    unsubscribe(handler) {
      this._subscribers.delete(handler);
    }

    _append(level, message) {
      const timestamp = new Date().toLocaleTimeString();
      const record = { level, message, timestamp };
      this._records.push(record);
      if (this._records.length > this._maxRecords) {
        this._records.shift();
      }
      this._subscribers.forEach((handler) => {
        try {
          handler(record, this._records);
        } catch (err) {
          console.error(err);
        }
      });
    }

    getRecords() {
      return [...this._records];
    }

    info(message) {
      this._append('info', message);
    }

    warn(message) {
      this._append('warn', message);
    }

    error(message) {
      this._append('error', message);
    }

    success(message) {
      this._append('success', message);
    }
  }

  const ConfigStore = {
    load() {
      const stored = parseJSONSafely(window.localStorage.getItem(CONFIG_STORAGE_KEY), null);
      if (!stored || !Array.isArray(stored.questions)) {
        return defaultConfig();
      }
      return {
        ...defaultConfig(),
        ...stored,
        version: SCRIPT_VERSION,
      };
    },
    save(config) {
      try {
        window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
      } catch (err) {
        console.error('保存配置失败', err);
      }
    },
  };

  const RunStateStore = {
    load() {
      const stored = parseJSONSafely(window.localStorage.getItem(RUN_STATE_KEY), null);
      if (!stored) {
        return defaultRunState();
      }
      return { ...defaultRunState(), ...stored };
    },
    save(state) {
      try {
        window.localStorage.setItem(RUN_STATE_KEY, JSON.stringify(state));
      } catch (err) {
        console.error('保存运行状态失败', err);
      }
    },
    clear() {
      try {
        window.localStorage.removeItem(RUN_STATE_KEY);
      } catch (err) {
        console.error(err);
      }
    },
  };

  const injectStyles = () => {
    if (document.getElementById('fwjx-style')) return;
    const style = document.createElement('style');
    style.id = 'fwjx-style';
    style.textContent = `
      .fwjx-panel {
        position: fixed;
        top: 72px;
        right: 24px;
        width: 360px;
        max-height: calc(100vh - 96px);
        font-family: "Segoe UI", "PingFang SC", sans-serif;
        font-size: 13px;
        color: #1f2328;
        background: rgba(255,255,255,0.98);
        border: 1px solid #cfd6e4;
        border-radius: 10px;
        box-shadow: 0 12px 32px rgba(15,23,42,0.18);
        z-index: 999999;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .fwjx-panel[data-collapsed="true"] {
        height: 42px;
        max-height: 42px;
      }
      .fwjx-panel__header {
        padding: 10px 14px;
        border-bottom: 1px solid #e3e8f0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: linear-gradient(135deg,#3161f1,#5b8bff);
        color: #fff;
      }
      .fwjx-panel__body {
        padding: 12px;
        overflow-y: auto;
      }
      .fwjx-panel__section {
        margin-bottom: 12px;
      }
      .fwjx-panel__section h4 {
        margin: 0 0 6px;
        font-size: 13px;
        color: #0f172a;
      }
      .fwjx-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0,1fr));
        gap: 6px 12px;
      }
      .fwjx-grid label {
        font-size: 12px;
        color: #4b5563;
      }
      .fwjx-grid input {
        width: 100%;
        margin-top: 2px;
        border: 1px solid #cbd5f5;
        border-radius: 4px;
        padding: 4px 6px;
      }
      .fwjx-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .fwjx-button {
        flex: 1 1 45%;
        padding: 6px 0;
        border-radius: 6px;
        border: none;
        cursor: pointer;
        font-size: 13px;
        color: #fff;
        background: #2563eb;
        transition: opacity .2s ease;
      }
      .fwjx-button[data-variant="secondary"] {
        background: #64748b;
      }
      .fwjx-button[data-variant="danger"] {
        background: #dc3545;
      }
      .fwjx-button:disabled {
        opacity: .4;
        cursor: not-allowed;
      }
      .fwjx-status {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        padding: 8px;
        font-size: 12px;
        line-height: 1.4;
      }
      .fwjx-question-list {
        max-height: 220px;
        overflow-y: auto;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
      }
      .fwjx-question-item {
        padding: 8px;
        border-bottom: 1px solid #e2e8f0;
      }
      .fwjx-question-item:last-child {
        border-bottom: none;
      }
      .fwjx-question-item__title {
        font-weight: 600;
        margin-bottom: 4px;
      }
      .fwjx-question-item__summary {
        font-size: 12px;
        color: #475569;
        margin-bottom: 6px;
      }
      .fwjx-question-item button {
        border: none;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        background: #155ee7;
        color: #fff;
        cursor: pointer;
      }
      .fwjx-log {
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        height: 160px;
        font-family: Consolas, Menlo, monospace;
        background: #0f172a;
        color: #f8fafc;
        padding: 6px;
        overflow-y: auto;
        font-size: 12px;
      }
      .fwjx-editor {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(15,23,42,0.65);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 1000000;
      }
      .fwjx-editor[data-visible="true"] {
        display: flex;
      }
      .fwjx-editor__card {
        width: 520px;
        max-height: 90vh;
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 16px 40px rgba(15,23,42,0.35);
        display: flex;
        flex-direction: column;
      }
      .fwjx-editor__header {
        padding: 12px 16px;
        border-bottom: 1px solid #e2e8f0;
        font-weight: 600;
      }
      .fwjx-editor__body {
        padding: 12px 16px;
        overflow-y: auto;
      }
      .fwjx-editor__textarea {
        width: 100%;
        height: 280px;
        border: 1px solid #cbd5f5;
        border-radius: 8px;
        font-family: Consolas, Menlo, monospace;
        font-size: 12px;
        padding: 8px;
      }
      .fwjx-editor__footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 16px;
        border-top: 1px solid #e2e8f0;
      }
      .fwjx-editor__footer button {
        padding: 6px 12px;
        border-radius: 6px;
        border: none;
        cursor: pointer;
        font-size: 13px;
      }
      .fwjx-editor__footer button[data-variant="primary"] {
        background: #2563eb;
        color: #fff;
      }
      .fwjx-editor__footer button[data-variant="ghost"] {
        background: #e2e8f0;
        color: #0f172a;
      }
    `;
    document.head.appendChild(style);
  };

  const buildQuestionSnapshot = (entry) => {
    const snapshot = {
      questionNum: entry.questionNum,
      title: entry.title,
      questionType: entry.questionType,
      distributionMode: entry.distributionMode || 'random',
      probabilities: entry.probabilities ?? null,
      customWeights: entry.customWeights ?? null,
      texts: entry.texts ?? null,
      textProbabilities: entry.textProbabilities ?? null,
      optionFillTexts: entry.optionFillTexts ?? null,
      fillableOptionIndices: entry.fillableOptionIndices ?? null,
      sliderRange: entry.sliderRange ?? null,
      multiLimit: entry.multiLimit ?? null,
    };
    if (entry.questionType === 'multiple') {
      snapshot.selectionProbabilities = entry.selectionProbabilities ?? null;
      snapshot.randomMulti = entry.randomMulti ?? false;
    }
    if (entry.questionType === 'matrix') {
      snapshot.matrixRows = entry.matrixRows;
      snapshot.optionCount = entry.optionCount;
    }
    return snapshot;
  };

  const applyQuestionSnapshot = (entry, snapshot) => {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error('无效的配置数据');
    }
    const safeFields = [
      'distributionMode',
      'probabilities',
      'customWeights',
      'texts',
      'textProbabilities',
      'optionFillTexts',
      'fillableOptionIndices',
      'sliderRange',
      'multiLimit',
      'selectionProbabilities',
      'randomMulti',
    ];
    safeFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(snapshot, field)) {
        entry[field] = snapshot[field];
      }
    });
  };

  class QuestionEditor {
    constructor(logger) {
      this.logger = logger;
      this.root = null;
      this.textarea = null;
      this.metaLabel = null;
      this.onSave = null;
      this.entry = null;
      this._build();
    }

    _build() {
      injectStyles();
      this.root = document.createElement('div');
      this.root.className = 'fwjx-editor';
      this.root.innerHTML = `
        <div class="fwjx-editor__card">
          <div class="fwjx-editor__header">题目配置</div>
          <div class="fwjx-editor__body">
            <div class="fwjx-editor__meta"></div>
            <div class="fwjx-editor__hint">
              可直接编辑 JSON（保留原字段），支持：
              <code>distributionMode</code>、<code>probabilities</code>、
              <code>texts</code>、<code>optionFillTexts</code>、<code>sliderRange</code> 等。
            </div>
            <textarea class="fwjx-editor__textarea"></textarea>
          </div>
          <div class="fwjx-editor__footer">
            <button data-variant="ghost" data-action="cancel">取消</button>
            <button data-variant="primary" data-action="save">保存</button>
          </div>
        </div>
      `;
      this.metaLabel = this.root.querySelector('.fwjx-editor__meta');
      this.textarea = this.root.querySelector('.fwjx-editor__textarea');
      this.root.addEventListener('click', (event) => {
        if (event.target.dataset.action === 'cancel') {
          this.close();
        }
        if (event.target.dataset.action === 'save') {
          this._submit();
        }
      });
      this.root.addEventListener('click', (event) => {
        if (event.target === this.root) {
          this.close();
        }
      });
      document.body.appendChild(this.root);
    }

    open(entry, onSave) {
      this.entry = entry;
      this.onSave = onSave;
      const snapshot = buildQuestionSnapshot(entry);
      this.metaLabel.textContent = `第${entry.questionNum}题 · ${QUESTION_TYPE_LABELS[entry.questionType] || entry.questionType}`;
      this.textarea.value = JSON.stringify(snapshot, null, 2);
      this.root.setAttribute('data-visible', 'true');
    }

    close() {
      this.entry = null;
      this.onSave = null;
      this.root.removeAttribute('data-visible');
    }

    _submit() {
      if (!this.entry || typeof this.onSave !== 'function') {
        this.close();
        return;
      }
      const raw = this.textarea.value;
      const parsed = parseJSONSafely(raw, null);
      if (!parsed) {
        this.logger.error('保存失败：JSON 解析错误');
        return;
      }
      try {
        applyQuestionSnapshot(this.entry, parsed);
        this.onSave(this.entry);
        this.logger.success(`题目 ${this.entry.questionNum} 配置已更新`);
        this.close();
      } catch (err) {
        this.logger.error(`保存失败：${err.message}`);
      }
    }
  }

  class UIPanel {
    constructor(logger, config, handlers) {
      this.logger = logger;
      this.config = config;
      this.handlers = handlers;
      this.editor = new QuestionEditor(logger);
      this.root = null;
      this.logView = null;
      this.listView = null;
      this.statusLabel = null;
      this.progressLabel = null;
      this.startButton = null;
      this.stopButton = null;
      this.targetInput = null;
      this.intervalMinInput = null;
      this.intervalMaxInput = null;
      this.answerMinInput = null;
      this.answerMaxInput = null;
      this._build();
    }

    _build() {
      injectStyles();
      this.root = document.createElement('div');
      this.root.className = 'fwjx-panel';
      this.root.innerHTML = `
        <div class="fwjx-panel__header">
          <div>
            new-wjx 脚本
            <small style="display:block;font-size:11px;">${SCRIPT_VERSION}</small>
          </div>
          <button class="fwjx-button" style="width:auto;padding:4px 8px;background:#ffffff22;" data-action="toggle">收起</button>
        </div>
        <div class="fwjx-panel__body">
          <div class="fwjx-panel__section">
            <h4>任务参数</h4>
            <div class="fwjx-grid">
              <label>目标份数
                <input type="number" min="1" value="1" data-field="targetNum" />
              </label>
              <label>最小间隔(秒)
                <input type="number" min="0" value="0" data-field="submitIntervalMin" />
              </label>
              <label>最大间隔(秒)
                <input type="number" min="0" value="0" data-field="submitIntervalMax" />
              </label>
              <label>答题最短(秒)
                <input type="number" min="0" value="0" data-field="answerDurationMin" />
              </label>
              <label>答题最长(秒)
                <input type="number" min="0" value="0" data-field="answerDurationMax" />
              </label>
            </div>
          </div>
          <div class="fwjx-panel__section">
            <div class="fwjx-actions">
              <button class="fwjx-button" data-action="parse">解析题目</button>
              <button class="fwjx-button" data-action="export">导出配置</button>
              <button class="fwjx-button" data-action="import">导入配置</button>
              <button class="fwjx-button" data-variant="secondary" data-action="start">开始执行</button>
              <button class="fwjx-button" data-variant="danger" data-action="stop">停止</button>
            </div>
          </div>
          <div class="fwjx-panel__section">
            <div class="fwjx-status">
              <div class="fwjx-status__line">状态：<span data-role="status">待机</span></div>
              <div class="fwjx-status__line">进度：<span data-role="progress">0/0</span></div>
            </div>
          </div>
          <div class="fwjx-panel__section">
            <h4>题目配置</h4>
            <div class="fwjx-question-list" data-role="question-list"></div>
          </div>
          <div class="fwjx-panel__section">
            <h4>运行日志</h4>
            <div class="fwjx-log" data-role="log"></div>
          </div>
        </div>
      `;
      document.body.appendChild(this.root);
      this.logView = this.root.querySelector('[data-role="log"]');
      this.listView = this.root.querySelector('[data-role="question-list"]');
      this.statusLabel = this.root.querySelector('[data-role="status"]');
      this.progressLabel = this.root.querySelector('[data-role="progress"]');
      this.startButton = this.root.querySelector('[data-action="start"]');
      this.stopButton = this.root.querySelector('[data-action="stop"]');
      this.targetInput = this.root.querySelector('input[data-field="targetNum"]');
      this.intervalMinInput = this.root.querySelector('input[data-field="submitIntervalMin"]');
      this.intervalMaxInput = this.root.querySelector('input[data-field="submitIntervalMax"]');
      this.answerMinInput = this.root.querySelector('input[data-field="answerDurationMin"]');
      this.answerMaxInput = this.root.querySelector('input[data-field="answerDurationMax"]');
      this.root.addEventListener('click', (event) => this._handleClick(event));
      this.targetInput.addEventListener('change', () => this._handleConfigInput());
      this.intervalMinInput.addEventListener('change', () => this._handleConfigInput());
      this.intervalMaxInput.addEventListener('change', () => this._handleConfigInput());
      this.answerMinInput.addEventListener('change', () => this._handleConfigInput());
      this.answerMaxInput.addEventListener('change', () => this._handleConfigInput());
      this.logger.subscribe((record) => this._appendLog(record));
      this.updateConfig(this.config);
    }

    _handleClick(event) {
      const action = event.target.dataset.action;
      if (!action) return;
      switch (action) {
        case 'toggle':
          {
            const collapsed = this.root.getAttribute('data-collapsed') === 'true';
            this.root.setAttribute('data-collapsed', String(!collapsed));
            event.target.textContent = collapsed ? '收起' : '展开';
          }
          break;
        case 'parse':
          this.handlers.onParse?.();
          break;
        case 'export':
          this.handlers.onExport?.();
          break;
        case 'import':
          this.handlers.onImport?.();
          break;
        case 'start':
          this.handlers.onStart?.();
          break;
        case 'stop':
          this.handlers.onStop?.();
          break;
        case 'edit':
          {
            const num = Number(event.target.dataset.question);
            const entry = (this.config.questions || []).find((item) => item.questionNum === num);
            if (entry) {
              this.editor.open(entry, (updated) => {
                this.handlers.onQuestionUpdate?.(updated);
                this.renderQuestions(this.config.questions);
              });
            }
          }
          break;
        default:
          break;
      }
    }

    _handleConfigInput() {
      const targetNum = Math.max(1, Number(this.targetInput.value) || 1);
      const intervalMin = Math.max(0, Number(this.intervalMinInput.value) || 0);
      const intervalMax = Math.max(intervalMin, Number(this.intervalMaxInput.value) || 0);
      const answerMin = Math.max(0, Number(this.answerMinInput.value) || 0);
      const answerMax = Math.max(answerMin, Number(this.answerMaxInput.value) || 0);
      this.targetInput.value = String(targetNum);
      this.intervalMinInput.value = String(intervalMin);
      this.intervalMaxInput.value = String(intervalMax);
      this.answerMinInput.value = String(answerMin);
      this.answerMaxInput.value = String(answerMax);
      const updated = {
        ...this.config,
        targetNum,
        submitInterval: { minSeconds: intervalMin, maxSeconds: intervalMax },
        answerDurationRange: { minSeconds: answerMin, maxSeconds: answerMax },
      };
      this.config = updated;
      this.handlers.onConfigChange?.(updated);
    }

    _appendLog(record) {
      if (!this.logView) return;
      const line = document.createElement('div');
      line.textContent = `[${record.timestamp}] [${record.level.toUpperCase()}] ${record.message}`;
      this.logView.appendChild(line);
      this.logView.scrollTop = this.logView.scrollHeight;
    }

    updateConfig(config) {
      this.config = { ...config };
      this.targetInput.value = String(config.targetNum || 1);
      this.intervalMinInput.value = String(config.submitInterval?.minSeconds ?? 0);
      this.intervalMaxInput.value = String(config.submitInterval?.maxSeconds ?? 0);
      this.answerMinInput.value = String(config.answerDurationRange?.minSeconds ?? 0);
      this.answerMaxInput.value = String(config.answerDurationRange?.maxSeconds ?? 0);
      this.renderQuestions(config.questions || []);
    }

    renderQuestions(questions) {
      if (!this.listView) return;
      this.listView.innerHTML = '';
      if (!questions.length) {
        this.listView.innerHTML = '<div class="fwjx-question-item">尚未解析问卷</div>';
        return;
      }
      questions.forEach((entry) => {
        const item = document.createElement('div');
        item.className = 'fwjx-question-item';
        item.innerHTML = `
          <div class="fwjx-question-item__title">第${entry.questionNum}题 · ${QUESTION_TYPE_LABELS[entry.questionType] || entry.questionType}</div>
          <div class="fwjx-question-item__summary">${describeQuestion(entry)}</div>
          <button data-action="edit" data-question="${entry.questionNum}">编辑</button>
        `;
        this.listView.appendChild(item);
      });
    }

    updateStatus(text) {
      if (this.statusLabel) {
        this.statusLabel.textContent = text;
      }
    }

    updateProgress(done, total) {
      if (this.progressLabel) {
        this.progressLabel.textContent = `${done}/${total}`;
      }
    }

    setRunning(running) {
      this.startButton.disabled = running;
      this.stopButton.disabled = !running;
    }
  }

  const describeQuestion = (entry) => {
    if (!entry) return '未知题目';
    if (entry.questionType === 'text' || entry.questionType === 'location') {
      const samples = (entry.texts || []).filter(Boolean).slice(0, 3).join(' | ');
      return samples || '自动生成随机内容';
    }
    if (entry.questionType === 'matrix') {
      const mode = entry.distributionMode === 'custom' ? '自定义配比' : '完全随机';
      return `${entry.matrixRows || 1} 行 × ${entry.optionCount || 1} 列 · ${mode}`;
    }
    if (entry.questionType === 'multiple') {
      if (entry.randomMulti || entry.selectionProbabilities === -1) {
        return `${entry.optionCount} 个选项 · 随机多选`;
      }
      return `${entry.optionCount} 个选项 · 自定义勾选概率`;
    }
    if (entry.questionType === 'slider') {
      const range = entry.sliderRange || { min: 10, max: 90 };
      return `随机得分 ${range.min} - ${range.max}`;
    }
    const mode = entry.distributionMode === 'custom' ? '自定义配比' : '完全随机';
    return `${entry.optionCount || 0} 个选项 · ${mode}`;
  };

  class QuestionParser {
    constructor(logger) {
      this.logger = logger;
    }

    parse() {
      const questionRoot = document.getElementById('divQuestion');
      if (!questionRoot) {
        throw new Error('未检测到问卷题目区域 (#divQuestion)');
      }
      const fieldsets = $$('fieldset[id^="fieldset"]', questionRoot);
      const containers = fieldsets.length ? fieldsets : [questionRoot];
      const questions = [];
      containers.forEach((fieldset, pageIndex) => {
        const questionDivs = $$('div[topic]', fieldset);
        questionDivs.forEach((div) => {
          const topicAttr = div.getAttribute('topic');
          if (!topicAttr || !/^\d+$/.test(topicAttr)) {
            return;
          }
          const questionNum = Number(topicAttr);
          const typeCode = div.getAttribute('type') || '0';
          const baseType = QUESTION_TYPE_MAP[typeCode] || 'unknown';
          const isLocation = baseType === 'text' && this._questionIsLocation(div);
          const questionType = isLocation ? 'location' : baseType;
          const title = this._extractTitle(div, questionNum);
          const optionLabels = this._collectOptionTexts(div, questionNum, baseType);
          const fillableIndices = this._detectFillableIndices(div, baseType, optionLabels.length);
          const optionFillTexts = fillableIndices.length ? Array(optionLabels.length).fill(null) : null;
          const multiLimit = baseType === 'multiple' ? this._detectMultiLimit(div) : null;
          const entry = {
            questionNum,
            pageIndex,
            title,
            questionType,
            optionCount: optionLabels.length,
            optionLabels,
            distributionMode: 'random',
            probabilities: null,
            customWeights: null,
            fillableOptionIndices: fillableIndices.length ? fillableIndices : null,
            optionFillTexts,
            texts: (questionType === 'text' || questionType === 'location') ? ['暂无意见', '无'] : null,
            textProbabilities: null,
            matrixRows: 0,
            sliderRange: { min: 20, max: 90 },
            randomMulti: true,
            selectionProbabilities: null,
            multiLimit,
            isLocation,
          };
          if (baseType === 'matrix') {
            const matrixInfo = this._collectMatrixInfo(questionNum);
            entry.matrixRows = matrixInfo.rows;
            entry.optionCount = matrixInfo.columns.length;
            entry.optionLabels = matrixInfo.columns;
          }
          if (baseType === 'dropdown') {
            entry.optionLabels = this._collectDropdownOptions(questionNum);
            entry.optionCount = entry.optionLabels.length;
          }
          if (baseType === 'slider') {
            entry.optionCount = 0;
          }
          questions.push(entry);
        });
      });
      if (!questions.length) {
        throw new Error('未能解析出任何题目，请确认当前页面是问卷填写页面');
      }
      this.logger.success(`解析完成，共 ${questions.length} 题`);
      return questions.sort((a, b) => a.questionNum - b.questionNum);
    }

    _extractTitle(container, questionNum) {
      const candidates = ['.topichtml', '.field-label', '.topicname', 'h2', 'h3'];
      for (const selector of candidates) {
        const node = container.querySelector(selector);
        if (node) {
          const text = normalizeText(node.textContent);
          if (text) {
            return text;
          }
        }
      }
      return `第${questionNum}题`;
    }

    _collectOptionTexts(container, questionNum, baseType) {
      if (baseType === 'dropdown') {
        return this._collectDropdownOptions(questionNum);
      }
      if (baseType === 'matrix') {
        const info = this._collectMatrixInfo(questionNum);
        return info.columns;
      }
      const optionElements = $$(`#div${questionNum} .ui-controlgroup > div`, container);
      if (!optionElements.length) {
        const fallback = $$(`#div${questionNum} .ui-radio`, container);
        if (fallback.length) {
          return fallback.map((node) => normalizeText(node.textContent));
        }
      }
      return optionElements.map((node) => normalizeText(node.textContent));
    }

    _collectDropdownOptions(questionNum) {
      const select = document.getElementById(`q${questionNum}`);
      if (!select) return [];
      const values = Array.from(select.options || []);
      return values
        .filter((opt) => opt.value && !opt.disabled)
        .map((opt) => normalizeText(opt.textContent));
    }

    _collectMatrixInfo(questionNum) {
      const rows = $$(`#divRefTab${questionNum} tr[rowindex]`);
      const columns = $$(`#drv${questionNum}_1 > td`).slice(1);
      return {
        rows: rows.length || 0,
        columns: columns.map((col) => normalizeText(col.textContent)),
      };
    }

    _questionIsLocation(container) {
      if (container.querySelector('.get_Local')) return true;
      const inputs = $$('input[verify], textarea[verify], input', container);
      return inputs.some((input) => {
        const verify = (input.getAttribute('verify') || '').toLowerCase();
        return verify.includes('map') || verify.includes('地图');
      });
    }

    _detectFillableIndices(container, baseType, optionCount) {
      if (!['single', 'multiple', 'scale'].includes(baseType)) {
        return [];
      }
      const optionElements = $$(':scope .ui-controlgroup > div', container);
      const indices = [];
      optionElements.forEach((node, index) => {
        if (this._elementHasTextInput(node)) {
          indices.push(index);
        }
      });
      if (!indices.length && optionCount > 0 && this._questionHasSharedInput(container)) {
        indices.push(optionCount - 1);
      }
      return indices;
    }

    _elementHasTextInput(element) {
      const inputs = $$('input, textarea', element);
      return inputs.some((input) => {
        const tag = (input.tagName || '').toLowerCase();
        const type = (input.getAttribute('type') || '').toLowerCase();
        return tag === 'textarea' || tag === 'input' && ['text', 'search', 'tel', 'number'].includes(type);
      });
    }

    _questionHasSharedInput(container) {
      if (container.querySelector('.ui-other input, .ui-other textarea')) return true;
      const text = normalizeText(container.textContent);
      return !!text && ['其他', '请注明', 'other', '填写'].some((keyword) => text.includes(keyword));
    }

    _detectMultiLimit(container) {
      for (const key of MULTI_LIMIT_KEYWORDS) {
        const attrValue = container.getAttribute(key) || container.getAttribute(key.toLowerCase());
        const numeric = Number(attrValue);
        if (numeric > 0) {
          return numeric;
        }
      }
      const attrs = container.getAttributeNames?.() || [];
      for (const attr of attrs) {
        const value = container.getAttribute(attr);
        if (!value) continue;
        try {
          const parsed = JSON.parse(value);
          if (typeof parsed === 'object') {
            for (const key of MULTI_LIMIT_KEYWORDS) {
              if (Object.prototype.hasOwnProperty.call(parsed, key)) {
                const numeric = Number(parsed[key]);
                if (numeric > 0) return numeric;
              }
            }
          }
        } catch (err) {
          /* noop */
        }
      }
      const content = normalizeText(container.textContent);
      for (const pattern of MULTI_LIMIT_PATTERNS) {
        const match = content.match(pattern);
        if (match && Number(match[1]) > 0) {
          return Number(match[1]);
        }
      }
      return null;
    }
  }

  class AnswerEngine {
    constructor(config, logger) {
      this.config = config;
      this.logger = logger;
    }

    updateConfig(config) {
      this.config = config;
    }

    fillQuestion(questionNum) {
      const entry = (this.config.questions || []).find((q) => q.questionNum === questionNum);
      const type = entry?.questionType || this._inferTypeFromDom(questionNum);
      switch (type) {
        case 'text':
        case 'location':
          this._fillTextQuestion(questionNum, entry);
          break;
        case 'single':
        case 'dropdown':
        case 'scale':
          this._fillSingleLikeQuestion(questionNum, entry);
          break;
        case 'multiple':
          this._fillMultipleQuestion(questionNum, entry);
          break;
        case 'matrix':
          this._fillMatrixQuestion(questionNum, entry);
          break;
        case 'slider':
          this._fillSliderQuestion(questionNum, entry);
          break;
        case 'reorder':
          this._fillReorderQuestion(questionNum);
          break;
        default:
          this.logger.warn(`第${questionNum}题类型未知，尝试随机填写`);
          this._fillSingleLikeQuestion(questionNum, entry);
      }
    }

    _inferTypeFromDom(questionNum) {
      const container = document.getElementById(`div${questionNum}`);
      if (!container) return 'single';
      const typeCode = container.getAttribute('type') || '3';
      return QUESTION_TYPE_MAP[typeCode] || 'single';
    }

    _fillTextQuestion(questionNum, entry) {
      const target = document.getElementById(`q${questionNum}`);
      if (!target) return;
      const candidates = (entry?.texts || ['无', '暂无意见']).filter(Boolean);
      const probabilities = entry?.textProbabilities;
      let selected = candidates[0] || '无';
      if (candidates.length > 1) {
        const index = probabilities ? weightedRandomIndex(probabilities) : randomInt(0, candidates.length - 1);
        selected = candidates[index] ?? candidates[0];
      }
      let lnglat = null;
      if (selected && selected.includes('|')) {
        const [text, l] = selected.split('|');
        if (LNGLAT_PATTERN.test(l)) {
          selected = text;
          lnglat = l;
        }
      }
      this._setInputValue(target, selected, lnglat);
    }

    _fillSingleLikeQuestion(questionNum, entry) {
      const container = document.getElementById(`div${questionNum}`);
      if (!container) return;
      const options = $$(`#div${questionNum} .ui-controlgroup > div`, container);
      if (entry?.questionType === 'dropdown') {
        this._fillDropdown(questionNum, entry);
        return;
      }
      if (entry?.questionType === 'scale') {
        this._fillScale(questionNum, entry);
        return;
      }
      if (!options.length) return;
      let selectedIndex = 0;
      if (entry?.distributionMode === 'custom' && Array.isArray(entry.customWeights)) {
        selectedIndex = weightedRandomIndex(entry.customWeights);
      } else if (entry?.probabilities && Array.isArray(entry.probabilities)) {
        selectedIndex = weightedRandomIndex(entry.probabilities);
      } else {
        selectedIndex = randomInt(0, options.length - 1);
      }
      selectedIndex = clamp(selectedIndex, 0, options.length - 1);
      const targetOption = options[selectedIndex];
      this._clickElement(targetOption);
      this._fillOptionAdditionalText(questionNum, selectedIndex, entry);
    }

    _fillDropdown(questionNum, entry) {
      const select = document.getElementById(`q${questionNum}`);
      if (!select || !(select.options && select.options.length)) {
        return;
      }
      const validOptions = Array.from(select.options).filter((opt) => opt.value && !opt.disabled);
      if (!validOptions.length) return;
      let selectedIndex = 0;
      if (entry?.distributionMode === 'custom' && Array.isArray(entry.customWeights)) {
        selectedIndex = weightedRandomIndex(entry.customWeights);
      } else if (entry?.probabilities && Array.isArray(entry.probabilities)) {
        selectedIndex = weightedRandomIndex(entry.probabilities);
      } else {
        selectedIndex = randomInt(0, validOptions.length - 1);
      }
      selectedIndex = clamp(selectedIndex, 0, validOptions.length - 1);
      const option = validOptions[selectedIndex];
      select.value = option.value;
      ['input', 'change'].forEach((evt) => select.dispatchEvent(new Event(evt, { bubbles: true })));
      const fillText = entry?.optionFillTexts?.[selectedIndex] ?? null;
      if (fillText) {
        this._fillOptionAdditionalText(questionNum, selectedIndex, entry);
      }
    }

    _fillScale(questionNum, entry) {
      const items = $$(`#div${questionNum} .ui-controlgroup li`);
      if (!items.length) return;
      let selectedIndex = 0;
      if (entry?.distributionMode === 'custom' && Array.isArray(entry.customWeights)) {
        selectedIndex = weightedRandomIndex(entry.customWeights);
      } else if (entry?.probabilities && Array.isArray(entry.probabilities)) {
        selectedIndex = weightedRandomIndex(entry.probabilities);
      } else {
        selectedIndex = randomInt(0, items.length - 1);
      }
      selectedIndex = clamp(selectedIndex, 0, items.length - 1);
      this._clickElement(items[selectedIndex]);
    }

    _fillMultipleQuestion(questionNum, entry) {
      const container = document.getElementById(`div${questionNum}`);
      if (!container) return;
      const options = $$(`#div${questionNum} .ui-controlgroup > div`, container);
      if (!options.length) return;
      const fillables = entry?.optionFillTexts || [];
      const maxLimit = entry?.multiLimit ? clamp(entry.multiLimit, 1, options.length) : options.length;
      const selectedIndices = [];
      if (entry?.randomMulti || entry?.selectionProbabilities === -1 || !entry?.selectionProbabilities) {
        const count = randomInt(1, Math.max(1, maxLimit));
        while (selectedIndices.length < count) {
          const idx = randomInt(0, options.length - 1);
          if (!selectedIndices.includes(idx)) {
            selectedIndices.push(idx);
          }
        }
      } else {
        const probabilities = entry.selectionProbabilities;
        probabilities.forEach((prob, idx) => {
          const chance = Number(prob) / 100;
          if (Math.random() < chance) {
            selectedIndices.push(idx);
          }
        });
        if (!selectedIndices.length) {
          selectedIndices.push(randomInt(0, options.length - 1));
        }
        if (selectedIndices.length > maxLimit) {
          selectedIndices.splice(maxLimit);
        }
      }
      selectedIndices.forEach((idx) => {
        const option = options[idx];
        if (option) {
          this._clickElement(option);
          const fill = fillables[idx];
          if (fill) {
            this._fillOptionAdditionalText(questionNum, idx, entry);
          }
        }
      });
    }

    _fillMatrixQuestion(questionNum, entry) {
      const rows = $$(`#divRefTab${questionNum} tr[rowindex]`);
      if (!rows.length) return;
      const columnCount = entry?.optionCount || (rows[0]?.querySelectorAll('td').length - 1) || 0;
      const weights = entry?.customWeights;
      for (let rowIndex = 1; rowIndex <= rows.length; rowIndex += 1) {
        let selectedColumn = 0;
        if (entry?.distributionMode === 'custom' && Array.isArray(weights)) {
          selectedColumn = weightedRandomIndex(weights);
        } else {
          selectedColumn = randomInt(0, Math.max(0, columnCount - 1));
        }
        const selector = `#drv${questionNum}_${rowIndex} > td:nth-child(${selectedColumn + 2})`;
        const cell = document.querySelector(selector);
        if (cell) {
          this._clickElement(cell);
        }
      }
    }

    _fillSliderQuestion(questionNum, entry) {
      const range = entry?.sliderRange || { min: 20, max: 90 };
      const score = randomInt(range.min, range.max);
      const input = document.getElementById(`q${questionNum}`);
      if (!input) return;
      input.value = String(score);
      ['input', 'change'].forEach((evt) => input.dispatchEvent(new Event(evt, { bubbles: true })));
    }

    _fillReorderQuestion(questionNum) {
      const items = $$(`#div${questionNum} ul > li`);
      if (!items.length) return;
      const indexes = items.map((_, idx) => idx);
      for (let i = 0; i < indexes.length; i += 1) {
        const from = randomInt(i, indexes.length - 1);
        this._clickElement(items[from]);
      }
    }

    _fillOptionAdditionalText(questionNum, optionIndex, entry) {
      if (!entry?.optionFillTexts) return;
      const text = entry.optionFillTexts[optionIndex];
      if (!text) return;
      const container = document.getElementById(`div${questionNum}`);
      if (!container) return;
      const option = container.querySelector(`.ui-controlgroup > div:nth-child(${optionIndex + 1})`);
      const targets = [];
      if (option) {
        targets.push(...$$('input[type="text"], input[type="search"], textarea', option));
      }
      if (!targets.length) {
        targets.push(...$$('.ui-other input, .ui-other textarea', container));
      }
      const input = targets.find((el) => el.offsetParent !== null) || targets[0];
      if (input) {
        input.value = text;
        ['input', 'change'].forEach((evt) => input.dispatchEvent(new Event(evt, { bubbles: true })));
      }
    }

    _setInputValue(element, value, lnglat) {
      if (!element) return;
      element.value = value || '';
      if (lnglat) {
        element.setAttribute('lnglat', lnglat);
      }
      ['input', 'change'].forEach((evt) => element.dispatchEvent(new Event(evt, { bubbles: true })));
    }

    _clickElement(element) {
      if (!element) return;
      try {
        element.click();
      } catch (err) {
        const evt = new MouseEvent('click', { bubbles: true });
        element.dispatchEvent(evt);
      }
    }
  }

  class AutomationController {
    constructor(logger, answerEngine) {
      this.logger = logger;
      this.answerEngine = answerEngine;
      this.stopRequested = false;
      this.running = false;
    }

    isRunning() {
      return this.running;
    }

    stop() {
      this.stopRequested = true;
    }

    async run(config) {
      if (this.running) {
        this.logger.warn('已有任务在执行中');
        return false;
      }
      try {
        this.running = true;
        this.stopRequested = false;
        await this._preparePage();
        const questionPlan = this._collectQuestionsPerPage();
        if (!questionPlan.length) {
          throw new Error('未能识别题目分页结构');
        }
        let currentQuestion = 0;
        for (let pageIndex = 0; pageIndex < questionPlan.length; pageIndex += 1) {
          const count = questionPlan[pageIndex];
          for (let i = 0; i < count; i += 1) {
            currentQuestion += 1;
            if (this.stopRequested) throw new Error('任务已手动停止');
            this.answerEngine.fillQuestion(currentQuestion);
            await sleep(80 + Math.random() * 120);
          }
          if (this.stopRequested) throw new Error('任务已手动停止');
          await sleep(300);
          await this._clickNextButton();
          await sleep(600);
        }
        if (this.stopRequested) throw new Error('任务已手动停止');
        await this._simulateAnswerDuration(config.answerDurationRange || { minSeconds: 0, maxSeconds: 0 });
        await this._waitForSubmitResult();
        this.logger.success('提交成功');
        return true;
      } finally {
        this.running = false;
      }
    }

    async _preparePage() {
      await this._dismissResumeDialog();
      await this._tryClickStartAnswer();
      await sleep(200);
    }

    _collectQuestionsPerPage() {
      const root = document.getElementById('divQuestion');
      if (!root) return [];
      const fieldsets = $$('fieldset[id^="fieldset"]', root);
      if (!fieldsets.length) {
        const total = $$('div[topic]', root).filter((div) => /^\d+$/.test(div.getAttribute('topic') || '')).length;
        return total ? [total] : [];
      }
      return fieldsets.map((fieldset) => {
        const divs = $$('div[topic]', fieldset);
        return divs.filter((div) => /^\d+$/.test(div.getAttribute('topic') || '')).length;
      });
    }

    async _clickNextButton() {
      const button = document.getElementById('divNext') || document.getElementById('ctlNext');
      if (!button) {
        this.logger.warn('未找到下一步按钮，可能已经在提交页面');
        return;
      }
      this._clickElement(button);
    }

    _clickElement(element) {
      try {
        element.click();
      } catch (err) {
        const evt = new MouseEvent('click', { bubbles: true });
        element.dispatchEvent(evt);
      }
    }

    async _dismissResumeDialog() {
      const buttons = $$('a.layui-layer-btn1');
      if (!buttons.length) return;
      buttons.forEach((btn) => {
        if (/取消/.test(btn.textContent || '')) {
          this._clickElement(btn);
        }
      });
      await sleep(200);
    }

    async _tryClickStartAnswer() {
      const startButton = Array.from(document.querySelectorAll('.slideChunkWord, button, a')).find((node) => {
        const text = (node.textContent || '').trim();
        return text.includes('开始作答');
      });
      if (startButton) {
        this._clickElement(startButton);
        await sleep(400);
      }
    }

    async _simulateAnswerDuration(range) {
      const min = Math.max(0, Number(range?.minSeconds) || 0);
      const max = Math.max(min, Number(range?.maxSeconds) || 0);
      if (max <= 0) return;
      const wait = min === max ? min : min + Math.random() * (max - min);
      this.logger.info(`模拟答题用时 ${wait.toFixed(1)} 秒`);
      await sleep(wait * 1000);
    }

    async _waitForSubmitResult(timeoutMs = 20000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (this.stopRequested) {
          throw new Error('任务已手动停止');
        }
        if (this._isAliyunCaptchaVisible()) {
          throw new Error('检测到阿里云智能验证，终止本次提交');
        }
        if (this._isSubmitSuccessPage()) {
          return;
        }
        await sleep(300);
      }
      throw new Error('等待提交结果超时');
    }

    _isAliyunCaptchaVisible() {
      const popup = document.getElementById('aliyunCaptcha-window-popup');
      return !!(popup && popup.offsetParent !== null);
    }

    _isSubmitSuccessPage() {
      const successSelectors = ['#divSuccess', '.smfgSubmitSuccessContent', '#smSuccess', '#submit_result'];
      if (successSelectors.some((selector) => document.querySelector(selector))) {
        return true;
      }
      const text = document.body?.innerText || '';
      return /提交成功|感谢|感谢您的参与/.test(text);
    }
  }

  const logger = new Logger();
  let config = ConfigStore.load();
  let runState = RunStateStore.load();
  const parser = new QuestionParser(logger);
  const answerEngine = new AnswerEngine(config, logger);
  const controller = new AutomationController(logger, answerEngine);

  const panel = new UIPanel(logger, config, {
    onParse: () => parseQuestions(),
    onStart: () => startAutomation(false),
    onStop: () => stopAutomation(),
    onExport: () => exportConfig(),
    onImport: () => importConfig(),
    onConfigChange: (updatedConfig) => updateConfig(updatedConfig),
    onQuestionUpdate: () => saveConfig(),
  });
  panel.setRunning(false);
  panel.updateStatus(runState.active ? '等待自动执行' : '待机');

  const saveConfig = () => {
    ConfigStore.save(config);
    answerEngine.updateConfig(config);
  };

  const updateConfig = (updated) => {
    config = { ...config, ...updated };
    saveConfig();
  };

  const parseQuestions = () => {
    try {
      const questions = parser.parse();
      config = { ...config, url: window.location.href, questions };
      panel.updateConfig(config);
      saveConfig();
    } catch (err) {
      logger.error(err.message || '解析失败');
    }
  };

  const exportConfig = async () => {
    const payload = JSON.stringify(config, null, 2);
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(payload);
        logger.success('配置已复制到剪贴板');
        return;
      } catch (err) {
        logger.warn('自动复制失败，已弹出窗口供手动复制');
      }
    }
    window.prompt('请复制配置 JSON：', payload);
  };

  const importConfig = () => {
    const raw = window.prompt('请粘贴配置 JSON：');
    if (!raw) return;
    const parsed = parseJSONSafely(raw, null);
    if (!parsed || !Array.isArray(parsed.questions)) {
      logger.error('配置格式无效');
      return;
    }
    config = {
      ...config,
      ...parsed,
      version: SCRIPT_VERSION,
    };
    panel.updateConfig(config);
    saveConfig();
    logger.success('配置导入完成');
  };

  const stopAutomation = () => {
    controller.stop();
    runState = { ...runState, active: false };
    RunStateStore.save(runState);
    panel.setRunning(false);
    panel.updateStatus('已停止');
  };

  const scheduleReloadForNextRun = () => {
    const interval = config.submitInterval || { minSeconds: 0, maxSeconds: 0 };
    const minMs = Math.max(0, Number(interval.minSeconds) || 0) * 1000;
    const maxMs = Math.max(minMs, Number(interval.maxSeconds) || 0) * 1000;
    const waitMs = maxMs > minMs ? minMs + Math.random() * (maxMs - minMs) : minMs;
    const url = runState.entryUrl || window.location.href.split('#')[0];
    logger.info(`等待 ${Math.round(waitMs / 100) / 10}s 后自动刷新继续`);
    window.setTimeout(() => {
      window.location.href = `${url}${url.includes('?') ? '&' : '?'}r=${Date.now()}`;
    }, Math.max(500, waitMs));
  };

  const startAutomation = async (autoResume) => {
    if (!config.questions.length) {
      logger.error('请先解析题目并配置答案');
      return;
    }
    if (controller.isRunning()) {
      logger.warn('已有任务执行中');
      return;
    }
    panel.setRunning(true);
    panel.updateStatus('执行中');
    if (!autoResume) {
      runState = {
        active: true,
        target: config.targetNum || 1,
        completed: 0,
        entryUrl: window.location.href.split('#')[0],
        lastError: '',
      };
    }
    RunStateStore.save(runState);
    try {
      const success = await controller.run(config);
      if (!success) {
        throw new Error('执行被中断');
      }
      runState.completed += 1;
      panel.updateProgress(runState.completed, runState.target);
      RunStateStore.save(runState);
      if (runState.completed >= runState.target) {
        logger.success('已达到目标份数');
        runState.active = false;
        RunStateStore.save(runState);
        panel.updateStatus('全部完成');
        panel.setRunning(false);
      } else {
        scheduleReloadForNextRun();
      }
    } catch (err) {
      logger.error(err.message || '执行失败');
      runState.lastError = err.message || '执行失败';
      runState.active = false;
      RunStateStore.save(runState);
      panel.setRunning(false);
      panel.updateStatus('失败/已停止');
    }
  };

  const autoResumeIfNeeded = () => {
    panel.updateProgress(runState.completed, runState.target);
    if (!runState.active) return;
    if (!(config.questions && config.questions.length)) {
      logger.warn('检测到运行状态但缺少题目配置，请重新解析');
      runState.active = false;
      RunStateStore.save(runState);
      panel.updateStatus('需先解析题目');
      return;
    }
    const isSuccessPage = controller._isSubmitSuccessPage();
    if (isSuccessPage && runState.completed < runState.target) {
      scheduleReloadForNextRun();
      return;
    }
    const delay = document.readyState === 'complete' ? 800 : 1500;
    window.setTimeout(() => startAutomation(true), delay);
  };

  autoResumeIfNeeded();
})();
