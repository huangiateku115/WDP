import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const customerSourceRoot = path.resolve(__dirname, '..');
const customerUiRoots = ['app', 'src/screens', 'src/components', 'src/domain', 'src/forms'];
const developerTerms = /Backend|Frontend|\bAPI\b|\bDTO\b|SKU V3|Operation Lookup|Cell Stock|\bSpecification\b|\bMovement\b|Readback|Revision|Ledger|Mock|Fixture|Demo|Phase|Technical|Runtime|\bfixture\b/i;

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.(tsx|ts)$/.test(file) && !/\.(test|spec)\.[^.]+$/.test(file) ? [file] : [];
  });
}

function customerCopyIssues(file: string): string[] {
  const contents = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const issues: string[] = [];
  const collectText = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const text = node.text.trim();
      if (/\s/.test(text) && !/^[A-Z0-9_]+$/.test(text) && !/^(\.\.?\/|\/)/.test(text) && developerTerms.test(text)) {
        issues.push(text);
      }
      return;
    }
    ts.forEachChild(node, collectText);
  };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) collectText(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return issues;
}

test('Customer Mobile source copy does not expose developer terms in routes, screens, components, or error messages', () => {
  const files = customerUiRoots.flatMap(root => sourceFiles(path.join(customerSourceRoot, root)));
  const issues = files.flatMap(file => customerCopyIssues(file).map(copy => `${path.relative(customerSourceRoot, file)}: ${copy}`));
  expect(issues).toEqual([]);
});

test('Managed inbound recovery copy preserves the recorded result and tells customers not to resubmit', () => {
  const inbound = fs.readFileSync(path.join(customerSourceRoot, 'src/components/ManagedInboundPreviewCard.tsx'), 'utf8');
  expect(inbound).toContain('Phiếu nhập đã được ghi nhận và đang cập nhật thông tin. Không gửi lại phiếu.');
  expect(inbound).toContain('Tồn kho hoặc lịch sử hàng hóa đang được cập nhật; không gửi lại phiếu.');
  expect(inbound).not.toMatch(/Operation Lookup|Cell Stock|Backend đã ghi nhận|Movement chưa xuất hiện/i);
});
