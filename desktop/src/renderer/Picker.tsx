import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import "./picker.css";

export interface PickerOption {
  value: string;
  label: string;
}

export interface PickerProps {
  id: string;
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  actionLabel?: string;
  align?: "start" | "end";
}

/** A select-only combobox with native light dismissal and no directional ornament. */
export function Picker({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
  placeholder,
  actionLabel,
  align = "start",
}: PickerProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const latest = useRef({ value, options, onChange, disabled });
  latest.current = { value, options, onChange, disabled };
  const pendingActive = useRef<number | null>(null);
  const typeahead = useRef({ text: "", time: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const panelId = `${id}-list`;
  const selected = options.find((option) => option.value === value);
  const currentLabel = selected?.label ?? placeholder ?? value;

  const place = useCallback(() => {
    const button = trigger.current;
    const popup = panel.current;
    if (!button || !popup) return;
    const rectangle = button.getBoundingClientRect();
    const margin = 12;
    const gap = 6;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(Math.max(rectangle.width, 200), 360, Math.max(0, viewportWidth - margin * 2));
    const anchorLeft = align === "end" ? rectangle.right - width : rectangle.left;
    const left = Math.max(margin, Math.min(anchorLeft, viewportWidth - width - margin));
    const below = Math.max(0, viewportHeight - rectangle.bottom - gap - margin);
    const above = Math.max(0, rectangle.top - gap - margin);
    const desired = Math.min(popup.scrollHeight || latest.current.options.length * 42 + 12, 320);
    const useBelow = below >= desired || below >= above;
    const available = useBelow ? below : above;
    const height = Math.min(desired, available);
    popup.style.width = `${width}px`;
    popup.style.maxHeight = `${Math.max(0, Math.min(320, available))}px`;
    popup.style.left = `${left}px`;
    popup.style.top = `${useBelow ? rectangle.bottom + gap : Math.max(margin, rectangle.top - gap - height)}px`;
  }, [align]);

  useEffect(() => {
    const popup = panel.current;
    if (!popup) return;
    const beforeToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === "open") {
        const selectedIndex = latest.current.options.findIndex((option) => option.value === latest.current.value);
        setActive(pendingActive.current ?? Math.max(0, selectedIndex));
        pendingActive.current = null;
        place();
      }
    };
    const toggle = (event: Event) => {
      const isOpen = (event as ToggleEvent).newState === "open";
      setOpen(isOpen);
      if (isOpen) {
        place();
        trigger.current?.focus({ preventScroll: true });
      }
    };
    const closeOnLayoutChange = (event: Event) => {
      // Scrolling the list itself is part of choosing; scrolling its anchor is not.
      if (event.target instanceof Node && popup.contains(event.target)) return;
      if (popup.matches(":popover-open")) popup.hidePopover();
    };
    popup.addEventListener("beforetoggle", beforeToggle);
    popup.addEventListener("toggle", toggle);
    window.addEventListener("resize", closeOnLayoutChange);
    window.addEventListener("scroll", closeOnLayoutChange, true);
    return () => {
      popup.removeEventListener("beforetoggle", beforeToggle);
      popup.removeEventListener("toggle", toggle);
      window.removeEventListener("resize", closeOnLayoutChange);
      window.removeEventListener("scroll", closeOnLayoutChange, true);
    };
  }, [place]);

  useEffect(() => {
    if (disabled && panel.current?.matches(":popover-open")) panel.current.hidePopover();
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const index = Math.min(active, Math.max(0, options.length - 1));
    panel.current?.querySelector<HTMLElement>(`[data-option-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, options.length]);

  function close(restoreFocus = false) {
    if (panel.current?.matches(":popover-open")) panel.current.hidePopover();
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }

  function show(index?: number) {
    if (disabled || !options.length || !panel.current || !trigger.current) return;
    pendingActive.current = index ?? null;
    if (!panel.current.matches(":popover-open")) panel.current.showPopover({ source: trigger.current });
  }

  function choose(index: number) {
    const option = latest.current.options[index];
    if (!option || latest.current.disabled) return;
    close(true);
    if (option.value !== latest.current.value) latest.current.onChange(option.value);
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const isOpen = panel.current?.matches(":popover-open") ?? false;
    const length = options.length;
    const selectedIndex = Math.max(
      0,
      options.findIndex((option) => option.value === value),
    );
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      if (!isOpen) show(selectedIndex);
      else setActive((index) => (index + step + length) % length);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const index = event.key === "Home" ? 0 : length - 1;
      if (!isOpen) show(index);
      else setActive(index);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (isOpen) choose(active);
      else show(selectedIndex);
      return;
    }
    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close();
      return;
    }
    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const time = Date.now();
      const previous = time - typeahead.current.time < 700 ? typeahead.current.text : "";
      const character = event.key.normalize("NFKC").toLocaleLowerCase();
      const text = previous + character;
      typeahead.current = { text, time };
      const prefix = [...text].every((part) => part === character) ? character : text;
      const start = isOpen ? active : selectedIndex;
      for (let offset = 1; offset <= length; offset++) {
        const index = (start + offset) % length;
        if (options[index].label.normalize("NFKC").toLocaleLowerCase().startsWith(prefix)) {
          event.preventDefault();
          if (!isOpen) show(index);
          else setActive(index);
          break;
        }
      }
    }
  }

  return (
    <div className="picker">
      <button
        id={id}
        ref={trigger}
        type="button"
        className="picker-trigger"
        role="combobox"
        aria-label={`${label}: ${currentLabel}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={panelId}
        aria-activedescendant={open && options[active] ? `${panelId}-option-${active}` : undefined}
        disabled={disabled || !options.length}
        popoverTarget={panelId}
        onKeyDown={keyDown}
        onKeyUp={(event) => {
          // A button's Space activation normally happens on keyup, after our choice.
          if (!event.nativeEvent.isComposing && (event.key === "Enter" || event.key === " ")) event.preventDefault();
        }}
      >
        <span className="picker-value">{currentLabel}</span>
        {actionLabel && (
          <span className="picker-action" aria-hidden="true">
            {actionLabel}
          </span>
        )}
      </button>
      <div id={panelId} ref={panel} popover="auto" role="listbox" aria-label={label} className="picker-popup">
        {options.map((option, index) => (
          <div
            key={option.value}
            id={`${panelId}-option-${index}`}
            role="option"
            aria-selected={option.value === value}
            tabIndex={-1}
            data-option-index={index}
            className={`picker-option ${index === active ? "is-active" : ""}`}
            onPointerMove={() => setActive(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(index)}
          >
            <span>{option.label}</span>
            <span className="picker-check" aria-hidden="true">
              {option.value === value && (
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                  <path
                    d="m4 10 4 4 8-8"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
