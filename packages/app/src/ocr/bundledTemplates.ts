/**
 * 同梱テンプレ（ocr/assets）→ ExtractTemplates（アプリ実行時に 1 度だけ構築）。
 *
 * 確定版テンプレは `@kagaribi/ocr/assets/*.json` にコミット同梱され、Vite が
 * バンドルする。ここで Template[] に展開して抽出層へ渡す。生成の単一の真実は
 * ocr/src/templates.ts（templatesFromJson）。
 */

import { templatesFromJson, type ExtractTemplates } from '@kagaribi/ocr';
import digitsJson from '@kagaribi/ocr/assets/digits.json';
import ranksJson from '@kagaribi/ocr/assets/ranks_hero.json';
import actionsJson from '@kagaribi/ocr/assets/actions.json';
import lettersJson from '@kagaribi/ocr/assets/letters_bb.json';
import actionMarksJson from '@kagaribi/ocr/assets/action_marks.json';

let cache: ExtractTemplates | undefined;

/** 同梱テンプレを ExtractTemplates として返す（メモ化）。 */
export function getBundledTemplates(): ExtractTemplates {
  if (!cache) {
    cache = {
      digits: templatesFromJson(digitsJson),
      ranks: templatesFromJson(ranksJson),
      actions: templatesFromJson(actionsJson),
      letters: templatesFromJson(lettersJson),
      marks: templatesFromJson(actionMarksJson),
    };
  }
  return cache;
}
