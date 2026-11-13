# Desktop workspace design

File Tidy is an operating workspace. The primary screen keeps folder setup and the classification preview visible together; it does not use a marketing hero, slogans, section numbers, or a large navigation rail. This replaces the previous desktop composition.

## Layout and hierarchy

The shell is a compact native titlebar, a view title with Organize / Rules / Activity navigation, the working area, and a narrow statusbar. At desktop sizes the Organize screen has a 292px setup column and a flexible file preview. Setup and the file table scroll independently; preview and execution controls remain visible. At smaller native window widths the setup column contracts; below 700px the layout stacks for browser fallback.

Headings use the platform sans family at 22px for the view, 14–15px for panels, and 12–14px for controls and file rows. Chinese uses the platform Chinese sans fallback with comfortable line height. There is no display font or fluid heading scale. Monospace is reserved for paths and JSON.

## Color and material

The canvas is cool pale gray (`#F4F5F7`), work surfaces are white, and text is charcoal (`#252B34`). Muted text remains readable (`#697380`). Blue fill and text mark selected filters, while primary actions use charcoal. Mint, amber, and soft purple distinguish organization, review, and duplicate states with text labels. The existing folder application icon provides the product's mint and yellow identity.

The visual reference is an archival finding aid: clear destination groupings, stable aligned rows, readable file names, and small counts. It contributes type, palette, density, and grouping discipline; it never changes familiar desktop controls into a simulated physical artifact.

Use white surfaces and spacing to separate regions. Do not nest decorative cards or apply shadows over borders. Inputs use quiet filled backgrounds rather than outlined pill containers. Keep radii at 6–10px for operating controls and work panels.

## Interaction and language

- No decorative arrows or chevrons in buttons, navigation, cards, text, SVG, backgrounds, masks, pseudo-elements, hover, focus, or expanded states. Pagination and disclosure use words. Application-owned choice controls use the shared arrowless `Picker`, including controls previously implemented with `select` or `datalist`. Preserve keyboard and assistive-technology semantics, not unnecessary browser-drawn indicators. Direction controls inside OS-owned file dialogs retain their necessary platform behavior.
- The full working interface supports Simplified Chinese and English. Language changes preserve folder inputs, previews, and unsaved JSON. Translate labels and system feedback, not file names, paths, JSON keys, or custom category names.
- Menus, language controls, fields, filters, pagination, execution, and undo have visible keyboard focus. Disabled controls remain identifiable. Native checkboxes/switches expose their checked state.
- Text inputs, search, and the JSON editor use one fine neutral bottom line for focus, not an outer rectangular outline. Composite folder/search fields draw the line on the filled control as a whole; their nested input must not draw a second indicator. Invalid fields use the error color for the same line. Keep button/choice keyboard focus and a system-colored outline for text input in forced-color mode.
- Feedback reflects actual analysis or execution. Never fabricate sample files, counts, activity, timers, or progress.
- Classification previews are read-only. Execution uses an explicit action after the destinations are visible. Undo confirmation remains inline and identifies the run.
- Loading, success, warning, failure, empty, hover, active, selected, and disabled states use the same color vocabulary. Motion is short and functional; reduced-motion and forced-color preferences remain usable.

## Verification sizes

Verify both languages at 1240×860, 1000×720, and the 760×600 native minimum. Check the 375px browser fallback for overflow, long mixed-language paths, and wrapped controls. Verify each of Organize, Rules, and Activity, plus a populated plan and errors. The table may scroll horizontally; the application shell must not.

## macOS Dock icon

The macOS application uses its own `resources/icon-macos.png` (1024px RGBA) and `resources/icon.icns`. Keep the recognizable mint folder and yellow checkmark, with a rounded ivory tile and generous transparent outer margin for a smaller optical size. The original `resources/icon.png` remains the in-app brand image. Runtime Dock assignment uses the same macOS PNG, so development and an updated running app do not show the old full-bleed square.

Regenerate the multi-resolution ICNS on macOS with `npm run icon:macos` in `desktop/`. This export requires no Apple account or certificate. Preserve alpha when replacing the source. Do not change the user's Dock size or restart the system Dock to compensate for incorrect artwork.

## Interface terminology

Use everyday, outcome-based wording across the full desktop flow, including helper text and errors. Preserve JSON keys, paths, saved folder names, and the core's internal vocabulary.

| Concept            | Chinese interface                  | English interface                        |
| ------------------ | ---------------------------------- | ---------------------------------------- |
| Input folder       | 待整理文件夹                       | Folder to organize                       |
| Output folder      | 整理后存放到 / 整理后的位置        | Organized files go to / New location     |
| In-place option    | 在当前文件夹内整理                 | Organize within this folder              |
| Recursive option   | 包含子文件夹内的文件               | Include files in subfolders              |
| Normal routing     | 分类存放                           | Sort into folders                        |
| Audio metadata     | 音频信息（歌手、专辑、歌曲名等）   | Audio details                            |
| Extension override | 文件类型规则 / 添加规则 / 移除规则 | File type rule / Add rule / Remove rule  |
| Shared JSON editor | 规则文件（JSON）                   | Rules file (JSON)                        |
| Run                | 这次整理 / 最近一次整理            | This organization / Latest organization  |
| Session list       | 本次打开后的记录                   | Since opening this window                |
| Undo               | 撤销这次整理 / 移回原来的位置      | Undo this organization / Move files back |

Use “文件夹” consistently in everyday Chinese UI. Use “整理” for the complete action and “分类” for rules or placement; avoid mixing them with “归档” or “归类”. Explain uncommon technical concepts when they matter: “指向其他位置的链接（符号链接）”. State that files move, exact duplicates and files needing attention are kept separately, and none are deleted. A record lists planned files and is not a backup; do not imply successful moves solely from its count. Empty scans say no files were found, not that a folder has been completely organized.

## Choice control contract

Finite choices use `Picker.tsx` and `picker.css`: show the current value and an explicit “更改 / Change” action, or “选择已有分类 / Choose a category”. Mark the selected option with a check, never a chevron, triangle, or substituted arrow. Native `select` and input `datalist` arrows are presentation too and do not qualify for the native-control exception. Editable folder names remain ordinary text inputs, with the existing-category picker as an optional helper.

The file-type form stays in one column at every supported width. Put the existing-category picker beside the folder-name label, with the full-width input below; the label row may wrap for long translations or category names. Use 8px between a label row and its input, 16px between field groups, and 16px before the full-width Add rule action. The helper keeps an intrinsic width and a minimum 28px target, without leaving an orphaned link beneath half-width inputs. Align its popup to the end of the trigger so the list stays close to the form instead of drifting into the JSON editor.

Verify closed, hovered, keyboard-focused, expanded, selected, and disabled states in both languages. Enter and Space open/select without submitting a form; arrow keys, Home/End and typeahead navigate; Escape dismisses without changing the value; Tab leaves the control; clicking outside must not steal focus. Popups must escape scrolling-panel clipping, fit the viewport, and close safely on disabled/unmount.

## Form validation

Application forms use `noValidate` with localized inline errors instead of browser validation bubbles. Keep required-field semantics. Show all invalid fields after an attempted submit, focus the first invalid input, preserve entered values, and update existing errors as the user corrects them. Associate each message with its input using `aria-describedby` and `aria-invalid`. Use a quiet error-tinted field background, ordinary keyboard focus, and 6–8px before the error text; do not add a second focus halo or a toast for a field error. Empty fields, invalid formats, reserved folder names, and duplicate custom rules need actionable Chinese and English wording. Invalid submissions must not analyze folders or update rules.

## Category rules

Rules defaults to visual settings. A compact category list includes configured categories, custom destinations from extension overrides, and the unmatched-file category. The detail panel shows supported extensions, date grouping, and ordered subfolder rules. Audio metadata presets appear only inside Audio. File type overrides have a separate navigation entry; Edit JSON switches the detail panel to the shared draft rather than adding a permanent third column. At narrow browser widths, use the shared arrowless Picker for category navigation.

The Organize setup summary gives every category the same two-line treatment: category name and supported format count, followed by active grouping and subfolder rule counts. Show all configured categories, custom extension destinations, and unmatched files. Derive the counts from the final extension mapping so overrides are not counted twice. Do not give audio or another individual category a separate highlighted summary.

Keep Save rules, Discard changes, and Use default rules visible in the panel footer at desktop sizes. Subfolder edits use an inline form with explicit Apply to draft and Cancel actions. Retain unfinished inputs across category, language, and top-level view changes; block saving and JSON editing until they are applied or canceled. Rule order is meaningful: use text actions to move earlier or later, and preserve first-match behavior. Omitted JSON keys inherit the actual core defaults; category and subcategory maps retain their whole-map replacement semantics. Unrelated advanced overrides must survive visual edits.
