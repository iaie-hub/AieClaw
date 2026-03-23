import mk from "@traptitech/markdown-it-katex";
/**
 * Markdown + LaTeX directive for mas4s.
 *
 * Extends the vendor markdown-it setup with @traptitech/markdown-it-katex
 * for inline ($...$) and block ($$...$$) LaTeX rendering via KaTeX.
 */
import { noChange } from "lit";
import { Directive, DirectiveParameters, Part, directive } from "lit/directive.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import MarkdownIt from "markdown-it";
import * as Sanitizer from "../../../../../vendor/a2ui/renderers/lit/src/0.8/ui/directives/sanitizer.js";

const createMd = () => {
  const md = MarkdownIt({
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

class MarkdownMathDirective extends Directive {
  #md = createMd();
  #lastValue: string | null = null;

  update(_part: Part, [value]: DirectiveParameters<this>) {
    if (this.#lastValue === value) {
      return noChange;
    }
    this.#lastValue = value;
    return this.render(value);
  }

  render(value: string) {
    return unsafeHTML(this.#md.render(value));
  }
}

export const markdownMath = directive(MarkdownMathDirective);
