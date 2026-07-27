# File Tidy Changelog

## [Initial Version] - {PR_MERGE_DATE}

- **Tidy Folder**: archive a folder's files into `ft_Category/[Subcategory]/[date]` buckets. Categories come from the file extension; subcategories (Screenshots, Ebooks, Invoices, Installers, …) from configurable name and extension rules. Date depth is per-category — photos and videos by year-month (EXIF capture date when available), documents by year, installers and fonts not by date at all.
- **Byte-level duplicate detection** (size → head/tail hash → full SHA-256) quarantines identical files instead of archiving them twice, and catches files that duplicate something already in the archive.
- **Near-duplicate detection**: files whose names match once copy markers, source watermarks and date stamps are stripped; the same name in another format; different version numbers of the same release. Flagged in the plan only — these are heuristics, so the files are still archived normally.
- **Similar-image detection**: perceptual hashing catches bursts, re-exports at another resolution, and messenger-recompressed copies that byte-level hashing cannot see. Flagged in the plan only.
- **Health checks**: zero-byte files, files whose content doesn't match their extension, and OS junk are moved to a review folder — never deleted.
- **Undo Last Tidy**: move every file from the last run back to its original location and clean up emptied folders.
- Always shows the full plan for confirmation before moving anything. Optional in-place mode (category folders inside the source folder), subfolder recursion, a toggle for the smart checks, and a configurable default destination.
