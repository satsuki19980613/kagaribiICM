import { describe, it, expect } from 'vitest';
import { listPrecache, renderServiceWorker, type BuiltFile, type PrecacheRules } from './swPlugin';

const RULES: PrecacheRules = {
  include: /\.(js|css|html|bin|json|svg|png|webp|webmanifest)$/,
  exclude: [/pf4way\.f16-.*\.bin$/],
  maxBytes: 100,
};

function file(path: string, content = path, bytes = content.length): BuiltFile {
  return { path, bytes, read: () => new TextEncoder().encode(content) };
}

describe('listPrecache', () => {
  it('名前にハッシュの入ったファイルは revision なし、ほかは内容のハッシュを付ける', () => {
    const { entries } = listPrecache([file('index.html'), file('assets/index-XFOhIvU3.js'), file('assets/nn5way.model.meta-Cocjybox.json'), file('theme.js')], RULES);
    expect(entries.map((e) => e.url)).toEqual(['assets/index-XFOhIvU3.js', 'assets/nn5way.model.meta-Cocjybox.json', 'index.html', 'theme.js']);
    expect(entries[0]!.revision).toBeNull();
    expect(entries[1]!.revision).toBeNull();
    expect(entries[2]!.revision).toMatch(/^[0-9a-f]{32}$/);
    expect(entries[3]!.revision).toMatch(/^[0-9a-f]{32}$/);
    expect(entries[2]!.revision).not.toBe(entries[3]!.revision);
  });

  it('assets の下でも、名前にハッシュが無ければ内容のハッシュを付ける', () => {
    const { entries } = listPrecache([file('assets/plain.js')], RULES);
    expect(entries[0]!.revision).not.toBeNull();
  });

  it('Service Worker 自身・対象外の拡張子・除外したもの・大きすぎるものは入れない', () => {
    const list = listPrecache(
      [file('sw.js'), file('_headers'), file('assets/font-AAAAAAAA.woff2'), file('assets/pf4way.f16-h_bEdJeO.bin'), file('assets/big-AAAAAAAA.bin', 'x', 101), file('icon.svg')],
      RULES,
    );
    expect(list.entries.map((e) => e.url)).toEqual(['icon.svg']);
    expect(list.tooLarge).toEqual(['assets/big-AAAAAAAA.bin']);
  });

  it('版は、配るものが変わったときだけ変わる（並び順には左右されない）', () => {
    const a = listPrecache([file('index.html', 'one'), file('theme.js')], RULES);
    const same = listPrecache([file('theme.js'), file('index.html', 'one')], RULES);
    const changed = listPrecache([file('index.html', 'two'), file('theme.js')], RULES);
    const added = listPrecache([file('index.html', 'one'), file('theme.js'), file('assets/a-AAAAAAAA.js')], RULES);
    expect(a.version).toMatch(/^[0-9a-f]{16}$/);
    expect(same.version).toBe(a.version);
    expect(changed.version).not.toBe(a.version);
    expect(added.version).not.toBe(a.version);
  });
});

describe('renderServiceWorker', () => {
  it('一覧と版を、本体より前に宣言する', () => {
    const list = listPrecache([file('index.html'), file('assets/index-XFOhIvU3.js')], RULES);
    const out = renderServiceWorker(list, '(()=>{BODY})();');
    const [head, body] = out.split('\n');
    expect(body).toBe('(()=>{BODY})();');
    const m = /^const PRECACHE_VERSION="([0-9a-f]{16})",PRECACHE_MANIFEST=(\[.*\]);$/.exec(head!);
    expect(m?.[1]).toBe(list.version);
    expect(JSON.parse(m![2]!)).toEqual(list.entries);
  });
});
