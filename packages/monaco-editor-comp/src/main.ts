import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { createRef, Ref, ref } from 'lit/directives/ref.js';

import { monacoStyles, MonacoWrapper, WorkerOverride } from './wrapper';

@customElement('monaco-editor-comp')
export class CodeEditor extends LitElement {

    private container: Ref<HTMLElement> = createRef();

    private monacoWrapper = new MonacoWrapper();

    @property({ reflect: true }) code = '';
    @property({ reflect: true }) languageId = 'javascript';
    @property({ reflect: true }) modifiedCode? = '';
    @property({ reflect: true }) modifiedLanguageId? = 'javascript';
    @property({ reflect: true }) theme = 'vs-light';
    @property({ type: Boolean, reflect: true }) enableInlineConfig? = false;
    @property({ type: Boolean, reflect: true }) useDiffEditor? = false;

    static override styles = css`
        :host {
            --editor-width: 100%;
            --editor-height: 100vh;
        }
        .main {
            width: var(--editor-width);
            height: var(--editor-height);
        }
    `;

    override render() {
        return html`
        <style>${monacoStyles}</style>
        <div ${ref(this.container)} id="monacoContainer${this.id}" class="main"></div>
        `;
    }

    setCode(code: string): void {
        this.code = code;
        this.monacoWrapper.getEditorConfig().codeOriginal[0] = code;
    }

    setLanguageId(languageId: string): void {
        this.languageId = languageId;
        this.monacoWrapper.getEditorConfig().codeOriginal[1] = languageId;
    }

    setModifiedCode(modifiedCode: string): void {
        this.modifiedCode = modifiedCode;
        this.monacoWrapper.getEditorConfig().codeModified[0] = modifiedCode;
    }

    setModifiedLanguageId(modifiedLanguageId: string): void {
        this.modifiedLanguageId = modifiedLanguageId;
        this.monacoWrapper.getEditorConfig().codeModified[1] = modifiedLanguageId;
    }

    setTheme(theme: string): void {
        this.theme = theme;
        this.monacoWrapper.getEditorConfig().theme = theme;
    }

    private startEditor(reloadInlineConfig: boolean) {
        this.syncPropertiesAndEditorConfig(reloadInlineConfig);
        this.monacoWrapper.startEditor(this.container.value!, this.dispatchEvent);
        this.registerListeners();
    }

    updateEditor(reloadInlineConfig: boolean) {
        this.syncPropertiesAndEditorConfig(reloadInlineConfig);
        this.monacoWrapper.updateEditor();
    }

    swapEditors(useDiffEditor: boolean, reloadInlineConfig: boolean): void {
        this.useDiffEditor = useDiffEditor;
        this.syncPropertiesAndEditorConfig(reloadInlineConfig);
        this.monacoWrapper.swapEditors(this.container.value!, this.dispatchEvent);
    }

    updateDiffEditorContent(code: string, languageId: string, modifiedCode: string, modifiedLanguageId: string) {
        this.setCode(code);
        this.setLanguageId(languageId);
        this.setModifiedCode(modifiedCode);
        this.setModifiedLanguageId(modifiedLanguageId);
    }

    loadInlineConfig() {
        if (this.isEnableInlineConfig()) {
            this.retrieveMonacoEditorOptions();
            this.retrieveMonacoDiffEditorOptions();
        }
    }

    private syncPropertiesAndEditorConfig(reloadInlineConfig: boolean) {
        if (reloadInlineConfig) {
            this.loadInlineConfig();
        }

        const wrapperConfig = this.monacoWrapper.getEditorConfig();
        wrapperConfig.codeOriginal[0] = this.code;
        wrapperConfig.codeOriginal[1] = this.languageId;
        if (this.modifiedCode) {
            wrapperConfig.codeModified[0] = this.modifiedCode;
        }
        if (this.modifiedLanguageId) {
            wrapperConfig.codeModified[1] = this.modifiedLanguageId;
        }
        wrapperConfig.theme = this.theme;

        this.monacoWrapper.setUseDiffEditor(this.useDiffEditor || false);
    }

    private buildAndCallConfigFunction(basename: string, loggingName: string): Record<string, unknown> | undefined {
        const winRec = window as unknown as Record<string, unknown>;
        const funcName = basename;
        const funcNamePlusId = `${funcName}${this.id}`;
        if (Object.prototype.hasOwnProperty.call(window, funcName) && typeof winRec[funcName] === 'function') {
            console.log(`Using config supplied by ${funcName} for ${loggingName}.`);
            return (winRec[funcName] as () => Record<string, unknown>)();
        } else if (Object.prototype.hasOwnProperty.call(winRec, funcNamePlusId) && typeof winRec[funcNamePlusId] === 'function') {
            console.log(`Using config supplied by ${funcNamePlusId} for ${loggingName}.`);
            return (winRec[funcNamePlusId] as () => Record<string, unknown>)();
        }
        else {
            return undefined;
        }
    }

    private retrieveMonacoEditorOptions() {
        if (!this.isEnableInlineConfig()) return;

        const options = this.buildAndCallConfigFunction('getMonacoEditorOptions', 'editor');
        this.setMonacoEditorOptions(options);
    }

    public setMonacoEditorOptions(options: Record<string, unknown> | undefined) {
        if (!options) return;

        if (options.code) {
            this.setCode(options.code as string);
        }
        if (options.languageId) {
            this.setLanguageId(options.languageId as string);
        }
        if (options.theme) {
            this.setTheme(options.theme as string);
        }
        this.monacoWrapper.getEditorConfig().monacoEditorOptions = options;
    }

    private retrieveMonacoDiffEditorOptions() {
        if (!this.isEnableInlineConfig()) return;

        const options = this.buildAndCallConfigFunction('getMonacoDiffEditorOptions', 'diff editor');
        this.setMonacoDiffEditorOptions(options);
    }

    public setMonacoDiffEditorOptions(options: Record<string, unknown> | undefined) {
        if (!options) return;

        if (options.code) {
            this.setCode(options.code as string);
        }
        if (options.languageId) {
            this.setLanguageId(options.languageId as string);
        }
        if (options.modifiedCode) {
            this.setModifiedCode(options.modifiedCode as string);
        }
        if (options.modifiedLanguageId) {
            this.setModifiedLanguageId(options.modifiedLanguageId as string);
        }
        if (options.theme) {
            this.setTheme(options.theme as string);
        }
        this.monacoWrapper.getEditorConfig().monacoDiffEditorOptions = options;
    }

    private isEnableInlineConfig() {
        const content = this.children.length === 1 ? this.children[0] : undefined;
        return content instanceof HTMLScriptElement && this.enableInlineConfig;
    }

    firstUpdated() {
        this.startEditor(true);
    }

    registerListeners() {
        window
            .matchMedia('(prefers-color-scheme: dark)')
            .addEventListener('change', (e) => {
                this.setTheme(e.matches ? 'vs-dark' : 'vs-light');
                this.monacoWrapper.updateTheme();
            });
    }

}

declare global {
    interface HTMLElementTagNameMap {
        'monaco-editor-comp': CodeEditor;
    }
}

export { WorkerOverride };
