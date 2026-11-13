import { useEffect, useRef, type FormEvent } from "react";
import type { Locale } from "../locale";
import { ruleText, type RuleCopyKey } from "./rule-copy";
import { validateSubRule, type SubRule } from "./rule-model";

export interface SubRuleDraft {
  category: string;
  index: number | null;
  name: string;
  extensions: string;
  patterns: string;
  submitted: boolean;
}

interface SubRuleEditorProps {
  locale: Locale;
  value: SubRuleDraft;
  busy: boolean;
  onChange: (value: SubRuleDraft) => void;
  onApply: (rule: SubRule) => void;
  onCancel: () => void;
}

export function SubRuleEditor({ locale, value, busy, onChange, onApply, onCancel }: SubRuleEditorProps) {
  const nameInput = useRef<HTMLInputElement>(null);
  const extensionsInput = useRef<HTMLInputElement>(null);
  const patternsInput = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const text = (key: RuleCopyKey) => ruleText(locale, key);
  const { errors } = validateSubRule(value.name, value.extensions, value.patterns);
  const visibleErrors = value.submitted ? errors : {};

  useEffect(() => {
    nameInput.current?.focus();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || composing.current) return;
    const result = validateSubRule(value.name, value.extensions, value.patterns);
    onChange({ ...value, submitted: true });
    if (!result.rule) {
      if (result.errors.name) nameInput.current?.focus();
      else if (result.errors.extensions) extensionsInput.current?.focus();
      else patternsInput.current?.focus();
      return;
    }
    onApply(result.rule);
  }

  return (
    <section className="sub-rule-editor" aria-labelledby="sub-rule-editor-title">
      <h3 id="sub-rule-editor-title">{text(value.index === null ? "newSubRule" : "editSubRule")}</h3>
      <form
        noValidate
        onSubmit={submit}
        onCompositionStartCapture={() => {
          composing.current = true;
        }}
        onCompositionEndCapture={() => {
          composing.current = false;
        }}
      >
        <fieldset disabled={busy}>
          <div className="field-group">
            <label className="field-label" htmlFor="sub-rule-name">
              {text("subFolderName")}
            </label>
            <input
              id="sub-rule-name"
              ref={nameInput}
              className="field-input"
              value={value.name}
              onChange={(event) => onChange({ ...value, name: event.target.value })}
              placeholder={text("subFolderNamePlaceholder")}
              required
              autoComplete="off"
              aria-invalid={Boolean(visibleErrors.name)}
              aria-describedby={visibleErrors.name ? "sub-rule-name-error" : undefined}
            />
            {visibleErrors.name && (
              <p id="sub-rule-name-error" className="field-error" role="alert">
                {text(visibleErrors.name)}
              </p>
            )}
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="sub-rule-extensions">
              {text("subExtensions")}
            </label>
            <input
              id="sub-rule-extensions"
              ref={extensionsInput}
              className="field-input"
              value={value.extensions}
              onChange={(event) => onChange({ ...value, extensions: event.target.value })}
              placeholder={text("subExtensionsPlaceholder")}
              spellCheck={false}
              autoCapitalize="none"
              autoComplete="off"
              dir="ltr"
              aria-invalid={Boolean(visibleErrors.extensions)}
              aria-describedby={visibleErrors.extensions ? "sub-rule-extensions-error" : undefined}
            />
            {visibleErrors.extensions && (
              <p id="sub-rule-extensions-error" className="field-error" role="alert">
                {text(visibleErrors.extensions)}
              </p>
            )}
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="sub-rule-patterns">
              {text("subPatterns")}
            </label>
            <textarea
              id="sub-rule-patterns"
              ref={patternsInput}
              className="field-input rule-textarea"
              value={value.patterns}
              onChange={(event) => onChange({ ...value, patterns: event.target.value })}
              placeholder={text("subPatternsPlaceholder")}
              rows={3}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              dir="ltr"
              aria-invalid={Boolean(visibleErrors.patterns)}
              aria-describedby={`sub-rule-patterns-help${visibleErrors.patterns ? " sub-rule-patterns-error" : ""}`}
            />
            <p id="sub-rule-patterns-help" className="rule-hint">
              {text("subPatternsHint")}
            </p>
            {visibleErrors.patterns && (
              <p id="sub-rule-patterns-error" className="field-error" role="alert">
                {text(visibleErrors.patterns)}
              </p>
            )}
          </div>
          <div className="sub-rule-actions">
            <button type="button" className="button button-quiet" onClick={onCancel}>
              {text("cancelEditing")}
            </button>
            <button type="submit" className="button button-secondary">
              {text("applySubRule")}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
