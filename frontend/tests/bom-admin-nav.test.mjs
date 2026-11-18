import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { activeSection } from "../src/lib/navSections.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// Sidebar entries are written as ['<path>', Icon, "<label>"] in both layouts.
const navPathsOf = (source, prefix) =>
  [...source.matchAll(/\['([a-z0-9-]+(?:\/[a-z0-9-]+)*)',\s*[A-Za-z][A-Za-z0-9]*\s*,\s*'/g)].map(([, path]) => `${prefix}${path}`);

for (const [workspace, file, prefix] of [
  ["BOM", "../src/layouts/BomLayout.jsx", "/bom/"],
  ["Admin", "../src/layouts/AdminLayout.jsx", "/admin/"],
]) {
  test(`${workspace} sidebar highlights exactly one section per route`, () => {
    const paths = navPathsOf(read(file), prefix);
    assert.ok(paths.length >= 19, `${workspace} sidebar entries parsed (${paths.length})`);
    for (const to of paths) {
      // The item must stay active on its own child/detail routes, and no sibling may also match.
      for (const pathname of [to, `${to}/000000000000000000000000`, `${to}/new`]) {
        assert.equal(activeSection(pathname, paths), to, `${pathname} must highlight only ${to}`);
      }
    }
  });

  test(`${workspace} policy sub-pages never highlight the parent as well`, () => {
    const paths = navPathsOf(read(file), prefix);
    const parent = paths.find((path) => path.endsWith("/policies"));
    const discounts = paths.find((path) => path.endsWith("/policies/discounts"));
    const categories = paths.find((path) => path.endsWith("/policies/item-categories"));
    assert.ok(parent && discounts && categories, `${workspace} exposes the policy family`);
    for (const [pathname, expected] of [
      [parent, parent],
      [`${parent}/68a`, parent],
      [discounts, discounts],
      [`${discounts}/68a`, discounts],
      [categories, categories],
      [`${categories}/68a`, categories],
    ]) {
      assert.equal(activeSection(pathname, paths), expected);
    }
  });
}

test("BOM and Admin sidebars share one active-item rule", () => {
  for (const file of ["../src/layouts/BomLayout.jsx", "../src/layouts/AdminLayout.jsx"]) {
    const source = read(file);
    assert.match(source, /activeSection\(pathname, ?navPaths\)/, `${file} must resolve the section`);
    assert.match(source, /aria-current=\{isActive\s*\?\s*'page'\s*:\s*undefined\}/, `${file} marks the current page`);
    // A bare NavLink matches every descendant route, which is what produced two active items.
    assert.doesNotMatch(source, /<NavLink/, `${file} must not rely on NavLink prefix matching`);
  }
});
