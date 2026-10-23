// Sidebar section highlighting.
//
// A nav item owns the current route when its path is a prefix of the pathname AND no
// other item matches with a longer path. That keeps a workspace highlighted on its own
// child/detail routes (e.g. /bom/oversight/facilities/:id -> "Facility oversight",
// /bom/reports/revenue -> "Reports") while still letting a more specific sibling item
// win (e.g. /bom/policies/discounts -> "Discounts / waivers" instead of "Business policies").
//
// The URL is the single source of truth here; location.state is never consulted, so the
// highlight survives reloads, bookmarks and shared links.

const within = (pathname, to) => pathname === to || pathname.startsWith(`${to}/`);

export function activeSection(pathname, paths = []) {
  let match = "";
  paths.forEach((to) => {
    if (within(pathname || "", to) && to.length > match.length) match = to;
  });
  return match;
}

export default activeSection;
