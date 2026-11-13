import { useMemo, useRef, useState, type FormEvent } from "react";
import type { Locale } from "../locale";
import { ruleCategoryLabel, ruleText, type RuleCopyKey } from "./rule-copy";
import { Picker } from "./Picker";
import { normalizeExtension, validateFileTypeRule } from "./rule-validation";
import {
  getRulesSnapshot,
  serializeRuleDraft,
  setCategoryGranularity,
  setCategorySubRules,
  type CategoryGranularity,
  type RuleObject,
  type SubRule,
} from "./rule-model";
import { SubRuleEditor, type SubRuleDraft } from "./SubRuleEditor";

interface RulesViewProps {
  locale: Locale;
  config: Record<string, unknown> | null;
  defaults: Record<string, unknown> | null;
  draft: string;
  setDraft: (value: string) => void;
  busy: boolean;
  hidden?: boolean;
  onSave: () => void;
  onDefaults: () => void;
  onDiscard: () => void;
}

const presets: Array<{ value: string; label: RuleCopyKey }> = [
  { value: "artist,album", label: "artistAlbum" },
  { value: "artist", label: "artist" },
  { value: "album", label: "album" },
  { value: "title", label: "title" },
  { value: "genre,artist,album", label: "genreArtistAlbum" },
  { value: "", label: "together" },
];
const dates: Array<{ value: CategoryGranularity; label: RuleCopyKey }> = [
  { value: "month", label: "dateMonth" },
  { value: "year", label: "dateYear" },
  { value: "none", label: "dateNone" },
];
const own = <T,>(map: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(map, key) ? map[key] : undefined;
const overrideCategory = (rule: unknown) =>
  typeof rule === "string"
    ? rule
    : rule && typeof rule === "object" && "category" in rule && typeof rule.category === "string"
      ? rule.category
      : null;

export function RulesView({
  locale,
  config,
  defaults,
  draft,
  setDraft,
  busy,
  hidden,
  onSave,
  onDefaults,
  onDiscard,
}: RulesViewProps) {
  const [selection, setSelection] = useState("category:Images");
  const [showJson, setShowJson] = useState(false);
  const [subEditor, setSubEditor] = useState<SubRuleDraft | null>(null);
  const [extension, setExtension] = useState("");
  const [category, setCategory] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const extensionInput = useRef<HTMLInputElement>(null);
  const categoryInput = useRef<HTMLInputElement>(null);
  const addSubButton = useRef<HTMLButtonElement>(null);
  const composing = useRef(false);
  const [feedback, setFeedback] = useState<RuleCopyKey | null>(null);
  const text = (key: RuleCopyKey, values?: Record<string, string | number>) => ruleText(locale, key, values);
  const { raw, effective } = useMemo(() => getRulesSnapshot(draft, defaults), [draft, defaults]);
  const dirty = draft !== (config ? serializeRuleDraft(config) : "");
  const extensions = effective?.extensions ?? {};
  const categoryNames = [
    ...new Set([
      ...Object.keys(effective?.categories ?? {}),
      ...Object.values(extensions)
        .map(overrideCategory)
        .filter((name): name is string => name !== null),
      ...(effective ? [effective.fallbackCategory] : []),
    ]),
  ];
  const options = [
    ...categoryNames.map((name) => ({ value: `category:${name}`, label: ruleCategoryLabel(locale, name) })),
    { value: "formats", label: text("formatsTitle") },
  ];
  const selected = options.some((option) => option.value === selection) ? selection : options[0].value;
  const isFormats = selected === "formats";
  const selectedCategory = isFormats ? "" : selected.slice("category:".length);
  const fallback = selectedCategory === effective?.fallbackCategory;
  const formats = new Map<string, string>();
  for (const [name, values] of Object.entries(effective?.categories ?? {}))
    for (const ext of values) formats.set(normalizeExtension(ext), name);
  for (const [ext, rule] of Object.entries(extensions)) {
    const name = overrideCategory(rule);
    if (name !== null) formats.set(normalizeExtension(ext), name);
  }
  const selectedFormats = [...formats].filter(([, name]) => name === selectedCategory).map(([ext]) => ext);
  const subRules = effective ? (own(effective.subCategories, selectedCategory) ?? []) : [];
  const currentGrouping = effective ? (own(effective.groupBy, selectedCategory) ?? []).join(",") : "";
  const currentDate = effective ? (own(effective.granularity, selectedCategory) ?? "none") : "none";
  const fieldErrors = submitted ? validateFileTypeRule(extension, category, extensions) : {};
  const editingHere = subEditor?.category === selectedCategory;

  function update(next: RuleObject) {
    setDraft(serializeRuleDraft(next));
    setFeedback(null);
  }
  function updateGrouping(value: string) {
    if (!raw || !effective || busy) return;
    const groupBy = raw.groupBy as RuleObject | undefined;
    update({ ...raw, groupBy: { ...groupBy, [selectedCategory]: value ? value.split(",") : [] } });
  }
  function updateSubRules(rules: SubRule[]) {
    if (!raw || busy) return;
    update(setCategorySubRules(raw, selectedCategory, rules, defaults));
  }
  function startSubRule(index: number | null) {
    const rule = index === null ? null : subRules[index];
    setSubEditor({
      category: selectedCategory,
      index,
      name: rule?.name ?? "",
      extensions: rule?.exts?.join(", ") ?? "",
      patterns: rule?.match?.join("\n") ?? "",
      submitted: false,
    });
  }
  function finishSubRule() {
    setSubEditor(null);
    requestAnimationFrame(() => addSubButton.current?.focus());
  }
  function applySubRule(rule: SubRule) {
    if (!subEditor || !editingHere || busy) return;
    const next = [...subRules];
    if (subEditor.index === null) next.push(rule);
    else next[subEditor.index] = { ...next[subEditor.index], ...rule, exts: rule.exts, match: rule.match };
    updateSubRules(next);
    finishSubRule();
  }
  function moveSubRule(index: number, step: number) {
    const next = [...subRules];
    [next[index], next[index + step]] = [next[index + step], next[index]];
    updateSubRules(next);
  }
  function addFormat(event: FormEvent) {
    event.preventDefault();
    if (!raw || !effective || busy || composing.current) return;
    const errors = validateFileTypeRule(extension, category, extensions);
    setSubmitted(true);
    setFeedback(null);
    if (errors.extension || errors.category) {
      (errors.extension ? extensionInput : categoryInput).current?.focus();
      return;
    }
    update({ ...raw, extensions: { ...extensions, [normalizeExtension(extension)]: category.trim() } });
    setExtension("");
    setCategory("");
    setSubmitted(false);
    setFeedback("extensionAdded");
  }
  function discard() {
    setSubEditor(null);
    setFeedback(null);
    onDiscard();
  }
  const stateText = !draft ? text("notLoaded") : dirty || subEditor ? text("unsaved") : text("saved");

  return (
    <section className="rules-layout category-rules-layout" aria-label={text("categorySettings")} hidden={hidden}>
      <aside className="rules-controls category-navigation">
        <div className="category-nav-heading">
          <h2>{text("categoriesTitle")}</h2>
          <p className="rule-hint">{text("categoriesDescription")}</p>
        </div>
        <div className="category-mobile-picker">
          <Picker
            id="rule-category"
            label={text("chooseCategory")}
            value={selected}
            options={options}
            onChange={(value) => {
              setSelection(value);
              setShowJson(false);
            }}
            actionLabel={text("changeChoice")}
            disabled={busy}
          />
        </div>
        <nav className="category-nav-list" aria-label={text("categoriesTitle")}>
          {categoryNames.map((name) => (
            <button
              key={name}
              type="button"
              className={`category-nav-item ${selected === `category:${name}` && !showJson ? "is-selected" : ""}`}
              aria-pressed={selected === `category:${name}` && !showJson}
              onClick={() => {
                setSelection(`category:${name}`);
                setShowJson(false);
              }}
              disabled={busy}
            >
              <span
                className={`category-color category-${Object.hasOwn(defaults?.categories ?? {}, name) ? name.toLowerCase() : "custom"}`}
                aria-hidden="true"
              />
              <span className="category-nav-name">
                <bdi>{ruleCategoryLabel(locale, name)}</bdi>
              </span>
              <span className="category-nav-count">
                {name === effective?.fallbackCategory
                  ? text("fallbackNav")
                  : [...formats.values()].filter((category) => category === name).length}
              </span>
            </button>
          ))}
          <button
            type="button"
            className={`category-nav-item category-nav-formats ${isFormats && !showJson ? "is-selected" : ""}`}
            aria-pressed={isFormats && !showJson}
            onClick={() => {
              setSelection("formats");
              setShowJson(false);
            }}
            disabled={busy}
          >
            <span className="category-nav-name">{text("formatsTitle")}</span>
            <span className="category-nav-count">{Object.keys(extensions).length}</span>
          </button>
        </nav>
      </aside>

      <section className="rules-editor category-settings-panel">
        <div className="editor-toolbar category-settings-toolbar">
          <div>
            <h2>
              {showJson
                ? text("editorTitle")
                : isFormats
                  ? text("formatsTitle")
                  : ruleCategoryLabel(locale, selectedCategory)}
            </h2>
            <p>
              {showJson
                ? text("editorDescription")
                : isFormats
                  ? text("formatsDescription")
                  : fallback
                    ? text("fallbackHint")
                    : text("folderName") + ": " + selectedCategory}
            </p>
          </div>
          <button
            type="button"
            className="button button-secondary json-toggle"
            aria-pressed={showJson}
            disabled={busy || Boolean(subEditor)}
            onClick={() => setShowJson(!showJson)}
          >
            {showJson ? text("visualEditor") : text("openJson")}
          </button>
        </div>

        {showJson ? (
          <textarea
            id="rules-json"
            className="code-editor"
            aria-label={text("editorTitle")}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            lang="en"
            dir="ltr"
            disabled={busy}
            aria-describedby="rules-json-help"
            aria-invalid={Boolean(draft && !raw)}
          />
        ) : !effective || !raw ? (
          <div className="category-settings-scroll">
            <p className="rule-hint" role="status">
              {defaults ? text("visualUnavailable") : text("loadingRules")}
            </p>
          </div>
        ) : (
          <div className="category-settings-scroll">
            <div className="category-settings-content">
              {isFormats ? (
                <section className="category-setting-section">
                  <form
                    className="extension-form"
                    noValidate
                    onSubmit={addFormat}
                    onCompositionStartCapture={() => {
                      composing.current = true;
                    }}
                    onCompositionEndCapture={() => {
                      composing.current = false;
                    }}
                  >
                    <fieldset disabled={busy}>
                      <div className="field-group">
                        <label htmlFor="custom-extension" className="field-label">
                          {text("extension")}
                        </label>
                        <input
                          id="custom-extension"
                          ref={extensionInput}
                          className="field-input"
                          value={extension}
                          onChange={(event) => {
                            setExtension(event.target.value);
                            setFeedback(null);
                          }}
                          placeholder={text("extensionPlaceholder")}
                          spellCheck={false}
                          autoCapitalize="none"
                          dir="ltr"
                          required
                          aria-invalid={Boolean(fieldErrors.extension)}
                          aria-describedby={fieldErrors.extension ? "custom-extension-error" : undefined}
                        />
                        {fieldErrors.extension && (
                          <p id="custom-extension-error" className="field-error" role="alert">
                            {text(fieldErrors.extension)}
                          </p>
                        )}
                      </div>
                      <div className="field-group">
                        <div className="category-field-heading">
                          <label htmlFor="custom-category" className="field-label">
                            {text("category")}
                          </label>
                          {categoryNames.length > 0 && (
                            <div className="category-picker">
                              <Picker
                                id="existing-category"
                                align="end"
                                label={text("chooseExistingCategory")}
                                placeholder={text("chooseExistingCategory")}
                                value={category}
                                options={categoryNames.map((name) => ({
                                  value: name,
                                  label: ruleCategoryLabel(locale, name),
                                }))}
                                onChange={(value) => {
                                  setCategory(value);
                                  setFeedback(null);
                                }}
                                disabled={busy}
                              />
                            </div>
                          )}
                        </div>
                        <input
                          id="custom-category"
                          ref={categoryInput}
                          className="field-input"
                          value={category}
                          onChange={(event) => {
                            setCategory(event.target.value);
                            setFeedback(null);
                          }}
                          placeholder={text("categoryPlaceholder")}
                          spellCheck={false}
                          required
                          aria-invalid={Boolean(fieldErrors.category)}
                          aria-describedby={fieldErrors.category ? "custom-category-error" : undefined}
                        />
                        {fieldErrors.category && (
                          <p id="custom-category-error" className="field-error" role="alert">
                            {text(fieldErrors.category)}
                          </p>
                        )}
                      </div>
                      <button className="button button-secondary" type="submit">
                        {text("addFormat")}
                      </button>
                    </fieldset>
                  </form>
                  {feedback && (
                    <p className="rule-feedback" role="status">
                      {text(feedback)}
                    </p>
                  )}
                  {Object.keys(extensions).length ? (
                    <ul className="extension-list" aria-label={text("formatsTitle")}>
                      {Object.entries(extensions).map(([ext, rule]) => (
                        <li className="extension-row" key={ext}>
                          <div>
                            <code dir="ltr">.{ext.replace(/^\./, "")}</code>
                            <span>
                              <bdi>{overrideCategory(rule)}</bdi>
                            </span>
                          </div>
                          <button
                            type="button"
                            className="button button-quiet"
                            disabled={busy}
                            onClick={() => {
                              update({
                                ...raw,
                                extensions: Object.fromEntries(
                                  Object.entries(extensions).filter(([key]) => key !== ext),
                                ),
                              });
                              setFeedback("extensionRemoved");
                            }}
                            aria-label={`${text("removeFormat")}: ${ext}`}
                          >
                            {text("removeFormat")}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rule-hint">{text("noCustomFormats")}</p>
                  )}
                </section>
              ) : (
                <>
                  <section className="category-setting-section">
                    <label className="field-label" htmlFor="category-date">
                      {text("dateGrouping")}
                    </label>
                    <p className="rule-hint">{text("dateDescription")}</p>
                    <div className="category-setting-picker">
                      <Picker
                        id="category-date"
                        label={text("dateGrouping")}
                        value={currentDate}
                        options={dates.map((date) => ({ value: date.value, label: text(date.label) }))}
                        onChange={(value) =>
                          update(setCategoryGranularity(raw, selectedCategory, value as CategoryGranularity))
                        }
                        actionLabel={text("changeChoice")}
                        disabled={busy}
                      />
                    </div>
                  </section>
                  {selectedCategory === "Audios" && (
                    <section className="category-setting-section">
                      <h3>{text("audioTitle")}</h3>
                      <p className="rule-hint">{text("audioDescription")}</p>
                      <div className="category-setting-picker">
                        <Picker
                          id="audio-grouping"
                          label={text("grouping")}
                          value={currentGrouping}
                          onChange={updateGrouping}
                          actionLabel={text("changeChoice")}
                          options={[
                            ...presets.map((preset) => ({ value: preset.value, label: text(preset.label) })),
                            ...(!presets.some((preset) => preset.value === currentGrouping)
                              ? [{ value: currentGrouping, label: text("customGrouping") }]
                              : []),
                          ]}
                          disabled={busy}
                        />
                      </div>
                      <p className="rule-hint">{text("groupingHint")}</p>
                    </section>
                  )}
                  <section className="category-setting-section sub-rules-section">
                    <div className="panel-heading">
                      <h3>{text("subFolders")}</h3>
                      <span className="rule-count">{subRules.length}</span>
                    </div>
                    <p className="rule-hint">{text("subFoldersDescription")}</p>
                    {subRules.length ? (
                      <ol className="sub-rule-list">
                        {subRules.map((rule, index) => (
                          <li key={index} className="sub-rule-row">
                            <div className="sub-rule-description">
                              <h4>
                                <bdi>{rule.name}</bdi>
                              </h4>
                              {rule.exts?.length ? (
                                <p>
                                  {text("matchedExtensions", {
                                    value: rule.exts.map((ext) => `.${ext.replace(/^\./, "")}`).join(", "),
                                  })}
                                </p>
                              ) : null}
                              {rule.match?.length ? (
                                <p>{text("matchedPatterns", { value: rule.match.join(" · ") })}</p>
                              ) : null}
                              {!rule.exts?.length && !rule.match?.length && <p>{text("noMatch")}</p>}
                            </div>
                            <div className="sub-rule-row-actions">
                              <button
                                type="button"
                                className="button button-quiet"
                                disabled={busy || Boolean(subEditor)}
                                onClick={() => startSubRule(index)}
                                aria-label={`${text("edit")}: ${rule.name}`}
                              >
                                {text("edit")}
                              </button>
                              <button
                                type="button"
                                className="button button-quiet"
                                disabled={busy || Boolean(subEditor) || index === 0}
                                onClick={() => moveSubRule(index, -1)}
                                aria-label={`${text("moveEarlier")}: ${rule.name}`}
                              >
                                {text("moveEarlier")}
                              </button>
                              <button
                                type="button"
                                className="button button-quiet"
                                disabled={busy || Boolean(subEditor) || index === subRules.length - 1}
                                onClick={() => moveSubRule(index, 1)}
                                aria-label={`${text("moveLater")}: ${rule.name}`}
                              >
                                {text("moveLater")}
                              </button>
                              <button
                                type="button"
                                className="button button-quiet"
                                disabled={busy || Boolean(subEditor)}
                                onClick={() => updateSubRules(subRules.filter((_, i) => i !== index))}
                                aria-label={`${text("remove")}: ${rule.name}`}
                              >
                                {text("remove")}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="rule-hint sub-rules-empty">{text("noSubFolders")}</p>
                    )}
                    {editingHere && subEditor ? (
                      <SubRuleEditor
                        locale={locale}
                        value={subEditor}
                        busy={busy}
                        onChange={setSubEditor}
                        onApply={applySubRule}
                        onCancel={finishSubRule}
                      />
                    ) : (
                      <button
                        ref={addSubButton}
                        type="button"
                        className="button button-secondary"
                        disabled={busy || Boolean(subEditor)}
                        onClick={() => startSubRule(null)}
                      >
                        {text("addSubRule")}
                      </button>
                    )}
                  </section>
                  <section className="category-setting-section">
                    <h3>{text("supportedExtensions")}</h3>
                    {selectedFormats.length > 0 && (
                      <ul className="format-tags" aria-label={text("supportedExtensions")}>
                        {selectedFormats.map((ext) => (
                          <li key={ext}>
                            <bdi>.{ext}</bdi>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="rule-hint">{fallback ? text("fallbackHint") : text("formatsHint")}</p>
                    <button
                      type="button"
                      className="button button-quiet rule-inline-action"
                      onClick={() => {
                        setCategory(selectedCategory);
                        setSelection("formats");
                      }}
                      disabled={busy}
                    >
                      {text("addFileTypeRule")}
                    </button>
                  </section>
                </>
              )}
            </div>
          </div>
        )}
        <div className="editor-footer category-settings-footer">
          <div className="category-save-status">
            <span className={`editor-state ${dirty || subEditor ? "" : "is-valid"}`}>{stateText}</span>
            <p id="rules-json-help">
              {subEditor ? text("finishEditing") : showJson && !raw ? text("invalidJsonHelp") : text("previewAgain")}
            </p>
            {subEditor && !editingHere && (
              <button
                type="button"
                className="button button-quiet"
                onClick={() => setSelection(`category:${subEditor.category}`)}
              >
                {text("continueEditing")}
              </button>
            )}
          </div>
          <div className="editor-actions">
            <button
              type="button"
              className="button button-quiet"
              onClick={() => {
                setSubEditor(null);
                setFeedback(null);
                onDefaults();
              }}
              disabled={busy}
            >
              {text("reset")}
            </button>
            <div>
              <button
                type="button"
                className="button button-secondary"
                onClick={discard}
                disabled={busy || (!dirty && !subEditor)}
              >
                {text("discard")}
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={onSave}
                disabled={busy || !raw || !dirty || Boolean(subEditor)}
              >
                {text("save")}
              </button>
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}
