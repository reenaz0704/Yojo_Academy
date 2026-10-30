/**
 * What each "type of content" accepts (owner, 29 Oct). A file must pass all three checks: its extension is on the
 * type's list, the browser-sent MIME type is one we expect for it (or generic), and its first bytes match the format.
 * Executables and scripts are on no list, so they are always refused.
 */
export const CONTENT_KINDS = ['video', 'document', 'slides', 'lab', 'image', 'cover'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

type Format = { mimes: string[]; sniff: (b: Buffer) => boolean };
const MB = 1024 * 1024;

const at = (b: Buffer, off: number, hex: string) => b.subarray(off, off + hex.length / 2).toString('hex') === hex;
const ascii = (b: Buffer, off: number, s: string) => b.subarray(off, off + s.length).toString('latin1') === s;
/** Plain text: no NUL bytes in the first 8 KB and valid UTF-8. */
const text = (b: Buffer) => {
  const head = b.subarray(0, 8192);
  if (head.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, Math.max(0, head.length - 4)));
    return true;
  } catch {
    return false;
  }
};
const zip = (b: Buffer) => at(b, 0, '504b0304') || at(b, 0, '504b0506');
const pdf = (b: Buffer) => ascii(b, 0, '%PDF-');
const mp4 = (b: Buffer) => ascii(b, 4, 'ftyp');

const FORMATS: Record<string, Format> = {
  mp4: { mimes: ['video/mp4'], sniff: mp4 },
  m4v: { mimes: ['video/mp4', 'video/x-m4v'], sniff: mp4 },
  mov: { mimes: ['video/quicktime'], sniff: (b) => mp4(b) || ascii(b, 4, 'moov') || ascii(b, 4, 'mdat') },
  webm: { mimes: ['video/webm'], sniff: (b) => at(b, 0, '1a45dfa3') },
  pdf: { mimes: ['application/pdf'], sniff: pdf },
  docx: {
    mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    sniff: (b) => zip(b) && b.includes('word/', 0, 'latin1'),
  },
  pptx: {
    mimes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    sniff: (b) => zip(b) && b.includes('ppt/', 0, 'latin1'),
  },
  txt: { mimes: ['text/plain'], sniff: text },
  md: { mimes: ['text/markdown', 'text/x-markdown', 'text/plain'], sniff: text },
  csv: { mimes: ['text/csv', 'application/vnd.ms-excel', 'text/plain'], sniff: text },
  log: { mimes: ['text/plain', 'text/x-log'], sniff: text },
  json: { mimes: ['application/json', 'text/plain'], sniff: text },
  zip: { mimes: ['application/zip', 'application/x-zip-compressed'], sniff: zip },
  pcap: {
    mimes: ['application/vnd.tcpdump.pcap', 'application/x-pcap'],
    sniff: (b) => at(b, 0, 'd4c3b2a1') || at(b, 0, 'a1b2c3d4') || at(b, 0, '4d3cb2a1') || at(b, 0, 'a1b23c4d'),
  },
  pcapng: { mimes: ['application/x-pcapng'], sniff: (b) => at(b, 0, '0a0d0d0a') },
  png: { mimes: ['image/png'], sniff: (b) => at(b, 0, '89504e470d0a1a0a') },
  jpg: { mimes: ['image/jpeg'], sniff: (b) => at(b, 0, 'ffd8ff') },
  jpeg: { mimes: ['image/jpeg'], sniff: (b) => at(b, 0, 'ffd8ff') },
  webp: { mimes: ['image/webp'], sniff: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP') },
  gif: { mimes: ['image/gif'], sniff: (b) => ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a') },
};

export const KIND_RULES: Record<ContentKind, { label: string; ext: string[]; maxBytes: number }> = {
  video: { label: 'Video', ext: ['mp4', 'm4v', 'mov', 'webm'], maxBytes: 200 * MB },
  document: { label: 'PDF / Document', ext: ['pdf', 'docx', 'txt', 'md'], maxBytes: 25 * MB },
  slides: { label: 'Slides', ext: ['pdf', 'pptx'], maxBytes: 50 * MB },
  lab: {
    label: 'Lab files / archive',
    ext: ['zip', 'pcap', 'pcapng', 'txt', 'csv', 'log', 'json', 'md'],
    maxBytes: 50 * MB,
  },
  image: { label: 'Image', ext: ['png', 'jpg', 'jpeg', 'webp', 'gif'], maxBytes: 5 * MB },
  cover: { label: 'Cover image', ext: ['png', 'jpg', 'jpeg', 'webp'], maxBytes: 2 * MB },
};
/** Largest single upload the server reads at all (the per-type limit is checked after). */
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(KIND_RULES).map((r) => r.maxBytes));

/** Hidden and system files inside an uploaded folder are skipped, not stored. */
export const isSystemFile = (relPath: string) =>
  relPath
    .split('/')
    .some((p) => p.startsWith('.') || p === '__MACOSX' || /^(thumbs\.db|desktop\.ini|\.ds_store)$/i.test(p));

/** Checks one file against its type. Returns the stored MIME type, or the reason it is refused. */
export function checkContent(
  kind: ContentKind,
  fileName: string,
  sentMime: string,
  data: Buffer,
): { ok: true; mime: string; ext: string } | { ok: false; reason: string } {
  const rule = KIND_RULES[kind];
  const ext = (fileName.match(/\.([a-z0-9]{1,8})$/i)?.[1] ?? '').toLowerCase();
  if (!rule.ext.includes(ext))
    return { ok: false, reason: `${rule.label} accepts ${rule.ext.map((e) => '.' + e).join(', ')} files only.` };
  if (!data.length) return { ok: false, reason: 'The file is empty.' };
  if (data.length > rule.maxBytes)
    return { ok: false, reason: `Too large: ${rule.label} files can be up to ${Math.round(rule.maxBytes / MB)} MB.` };
  const f = FORMATS[ext];
  const generic = ['', 'application/octet-stream'].includes(sentMime);
  if (!generic && !f.mimes.includes(sentMime))
    return { ok: false, reason: `The browser says this is ${sentMime}, which does not match a .${ext} file.` };
  if (!f.sniff(data)) return { ok: false, reason: `The contents are not a real .${ext} file.` };
  return { ok: true, mime: f.mimes[0], ext };
}
