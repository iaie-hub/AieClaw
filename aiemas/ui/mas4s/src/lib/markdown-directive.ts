import mk from "@traptitech/markdown-it-katex";
import { noChange } from "lit";
/**
 * Markdown + LaTeX directive for mas4s.
 *
 * Extends the vendor markdown-it setup with @traptitech/markdown-it-katex
 * for inline ($...$) and block ($$...$$) LaTeX rendering via KaTeX.
 */
import { AsyncDirective } from "lit/async-directive.js";
import { DirectiveParameters, Part, directive } from "lit/directive.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import MarkdownIt from "markdown-it";
// @ts-expect-error
import * as Sanitizer from "../../../../../vendor/a2ui/renderers/lit/src/0.8/ui/directives/sanitizer.js";

const createMd = () => {
  const md = new MarkdownIt({
    breaks: true,
    highlight: (str, lang) => {
      if (lang === "html") {
        const iframe = document.createElement("iframe");
        iframe.classList.add("html-view");
        iframe.srcdoc = str;
        iframe.sandbox = "";
        return iframe.innerHTML;
      }
      return Sanitizer.escapeNodeText(str);
    },
  });
  // Register KaTeX plugin: $...$ inline, $$...$$ block
  md.use(mk, { throwOnError: false, errorColor: "#cc0000" });
  return md;
};

class MarkdownMathDirective extends AsyncDirective {
  #md = createMd();
  #lastValue: string | null = null;
  #pendingValue: string | null = null;
  #timeoutId: number | null = null;

  render(value: string) {
    // 自动补全可能被截断的表格结构，增加解析稳定性
    let stableValue = value;
    if (stableValue.includes("|") && !stableValue.endsWith("\n")) {
      stableValue += "\n";
    }
    return unsafeHTML(this.#md.render(stableValue));
  }

  update(_part: Part, [value]: DirectiveParameters<this>) {
    if (this.#lastValue === value) {
      return noChange;
    }

    // 首次渲染直接同步绘制，不缓冲
    if (this.#lastValue === null) {
      this.#lastValue = value;
      return this.render(value);
    }

    // 缓冲渲染策略: 避免高速 stream 更新时 partial markdown 导致 HTML 在 <p> 和 <table> 之间剧烈抖动
    if (this.#timeoutId !== null) {
      window.clearTimeout(this.#timeoutId);
    }

    this.#pendingValue = value;
    this.#timeoutId = window.setTimeout(() => {
      if (this.#pendingValue !== null) {
        this.#lastValue = this.#pendingValue;
        this.setValue(this.render(this.#pendingValue));
        this.#pendingValue = null;
      }
      this.#timeoutId = null;
    }, 120);

    return noChange;
  }

  protected disconnected() {
    if (this.#timeoutId !== null) {
      window.clearTimeout(this.#timeoutId);
      this.#timeoutId = null;
    }
  }
}

export const markdownMath = directive(MarkdownMathDirective);
