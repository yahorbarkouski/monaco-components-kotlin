import { EditorAppVscodeApi, EditorAppConfigVscodeApi } from './editorVscodeApi.js';
import { EditorAppClassic, EditorAppConfigClassic } from './editorClassic.js';
import { editor } from 'monaco-editor/esm/vs/editor/editor.api.js';
import { InitializeServiceConfig, initServices, MonacoLanguageClient, wasVscodeApiInitialized } from 'monaco-languageclient';
import { toSocket, WebSocketMessageReader, WebSocketMessageWriter } from 'vscode-ws-jsonrpc';
import { BrowserMessageReader, BrowserMessageWriter } from 'vscode-languageserver-protocol/browser.js';
import { CloseAction, ErrorAction, MessageTransports } from 'vscode-languageclient/lib/common/client.js';
import { createUrl } from './utils.js';
import { VscodeUserConfiguration, isVscodeApiEditorApp } from './editor.js';

export type WebSocketCallOptions = {
    /** Adds handle on languageClient */
    onCall: () => void;
    /** Reports Status Of Language Client */
    reportStatus?: boolean;
}

export type LanguageClientConfigType = 'WebSocket' | 'WebSocketUrl' | 'WorkerConfig' | 'Worker';

export type WebSocketUrl = {
    secured: boolean;
    host: string;
    port?: number;
    path?: string;
}

export type WebSocketConfigOptions = {
    configType: 'WebSocket'
    secured: boolean;
    host: string;
    port?: number;
    path?: string;
    startOptions?: WebSocketCallOptions;
    stopOptions?: WebSocketCallOptions;
}

export type WebSocketConfigOptionsUrl = {
    configType: 'WebSocketUrl'
    url: string;
    startOptions?: WebSocketCallOptions;
    stopOptions?: WebSocketCallOptions;
}

export type WorkerConfigOptions = {
    configType: 'WorkerConfig'
    url: URL;
    type: 'classic' | 'module';
    name?: string;
};

export type WorkerConfigDirect = {
    configType: 'WorkerDirect';
    worker: Worker;
};

export type LanguageClientConfig = {
    options: WebSocketConfigOptions | WebSocketConfigOptionsUrl | WorkerConfigOptions | WorkerConfigDirect;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initializationOptions?: any;
}

export type WrapperConfig = {
    serviceConfig?: InitializeServiceConfig;
    editorAppConfig: EditorAppConfigVscodeApi | EditorAppConfigClassic;
};

export type UserConfig = {
    id?: string;
    htmlElement: HTMLElement;
    wrapperConfig: WrapperConfig;
    languageClientConfig?: LanguageClientConfig;
}

export type ModelUpdate = {
    languageId?: string;
    code?: string;
    uri?: string;
    codeOriginal?: string;
    codeOriginalUri?: string;
}

export class MonacoEditorLanguageClientWrapper {

    private languageClient: MonacoLanguageClient | undefined;
    private worker: Worker | undefined;

    private editorApp: EditorAppClassic | EditorAppVscodeApi | undefined;

    private id: string;
    private htmlElement: HTMLElement;
    private serviceConfig: InitializeServiceConfig;
    private languageClientConfig?: LanguageClientConfig;

    private init(userConfig: UserConfig) {
        if (userConfig.wrapperConfig.editorAppConfig.useDiffEditor && !userConfig.wrapperConfig.editorAppConfig.codeOriginal) {
            throw new Error('Use diff editor was used without a valid config.');
        }

        this.id = userConfig.id ?? Math.floor(Math.random() * 101).toString();
        this.htmlElement = userConfig.htmlElement;

        if (userConfig.languageClientConfig) {
            this.languageClientConfig = userConfig.languageClientConfig;
        }

        this.serviceConfig = userConfig.wrapperConfig.serviceConfig ?? {};

        // always set required services if not configure
        this.serviceConfig.enableModelService = this.serviceConfig.enableModelService ?? true;
        this.serviceConfig.configureEditorOrViewsServiceConfig = this.serviceConfig.configureEditorOrViewsServiceConfig ?? {
        };
        this.serviceConfig.configureConfigurationServiceConfig = this.serviceConfig.configureConfigurationServiceConfig ?? {
            defaultWorkspaceUri: '/tmp/'
        };
    }

    async start(userConfig: UserConfig) {
        this.init(userConfig);

        // Always dispose old instances before start
        this.editorApp?.disposeEditor();
        this.editorApp?.disposeDiffEditor();

        if (isVscodeApiEditorApp(userConfig.wrapperConfig)) {
            this.editorApp = new EditorAppVscodeApi(this.id, userConfig);
        } else {
            this.editorApp = new EditorAppClassic(this.id, userConfig);
        }
        await (wasVscodeApiInitialized() ? Promise.resolve('No service init on restart') : initServices(this.serviceConfig));
        await this.editorApp?.init();
        await this.editorApp.createEditors(this.htmlElement);

        if (this.languageClientConfig) {
            console.log('Starting monaco-languageclient');
            await this.startLanguageClientConnection();
        } else {
            await Promise.resolve('All fine. monaco-languageclient is not used.');
        }
    }

    isStarted(): boolean {
        // fast-fail
        if (!this.editorApp?.haveEditor()) {
            return false;
        }

        if (this.languageClientConfig) {
            return this.languageClient !== undefined && this.languageClient.isRunning();
        }
        return true;
    }

    getMonacoEditorApp() {
        return this.editorApp;
    }

    getEditor(): editor.IStandaloneCodeEditor | undefined {
        return this.editorApp?.getEditor();
    }

    getDiffEditor(): editor.IStandaloneDiffEditor | undefined {
        return this.editorApp?.getDiffEditor();
    }

    getLanguageClient(): MonacoLanguageClient | undefined {
        return this.languageClient;
    }

    getModel(original?: boolean): editor.ITextModel | undefined {
        return this.editorApp?.getModel(original);
    }

    getWorker(): Worker | undefined {
        return this.worker;
    }

    async updateModel(modelUpdate: ModelUpdate): Promise<void> {
        await this.editorApp?.updateModel(modelUpdate);
    }

    async updateDiffModel(modelUpdate: ModelUpdate): Promise<void> {
        await this.editorApp?.updateDiffModel(modelUpdate);
    }

    async updateEditorOptions(options: editor.IEditorOptions & editor.IGlobalEditorOptions | VscodeUserConfiguration): Promise<void> {
        if (this.editorApp) {
            await this.editorApp.updateConfig(options);
        } else {
            await Promise.reject('Update was called when editor wrapper was not correctly configured.');
        }
    }

    /**
     * Restart the languageclient with options to control worker handling
     *
     * @param updatedWorker Set a new worker here that should be used. keepWorker has no effect theb
     * @param keepWorker Set to true if worker should not be disposed
     */
    async restartLanguageClient(updatedWorker?: Worker, keepWorker?: boolean): Promise<void> {
        if (updatedWorker) {
            await this.disposeLanguageClient(false);
        } else {
            await this.disposeLanguageClient(keepWorker);
        }
        this.worker = updatedWorker;
        if (this.languageClientConfig) {
            console.log('Re-Starting monaco-languageclient');
            await this.startLanguageClientConnection();
        } else {
            await Promise.reject('Unable to restart languageclient. No configuration was provided.');
        }
    }

    public reportStatus() {
        const status: string[] = [];
        status.push('Wrapper status:');
        status.push(`Editor: ${this.editorApp?.getEditor()}`);
        status.push(`DiffEditor: ${this.editorApp?.getDiffEditor()}`);
        status.push(`LanguageClient: ${this.languageClient}`);
        status.push(`Worker: ${this.worker}`);
        return status;
    }

    async dispose(): Promise<void> {
        this.editorApp?.disposeEditor();
        this.editorApp?.disposeDiffEditor();

        if (this.languageClientConfig) {
            await this.disposeLanguageClient(false);
            this.editorApp = undefined;
            await Promise.resolve('Monaco editor and languageclient completed disposed.');
        }
        else {
            await Promise.resolve('Monaco editor has been disposed.');
        }
    }

    public async disposeLanguageClient(keepWorker?: boolean): Promise<void> {
        if (this.languageClient && this.languageClient.isRunning()) {
            try {
                await this.languageClient.dispose();
                if (keepWorker === undefined || keepWorker === false) {
                    this.worker?.terminate();
                    this.worker = undefined;
                }
                this.languageClient = undefined;
                await Promise.resolve('monaco-languageclient and monaco-editor were successfully disposed.');
            } catch (e) {
                await Promise.reject(`Disposing the monaco-languageclient resulted in error: ${e}`);
            }
        }
        else {
            await Promise.reject('Unable to dispose monaco-languageclient: It is not yet started.');
        }
    }

    updateLayout() {
        this.editorApp?.updateLayout();
    }

    private startLanguageClientConnection(): Promise<string> {
        if (this.languageClient && this.languageClient.isRunning()) {
            return Promise.resolve('monaco-languageclient already running!');
        }

        return new Promise((resolve, reject) => {
            const lcConfig = this.languageClientConfig?.options;
            if (lcConfig?.configType === 'WebSocket' || lcConfig?.configType === 'WebSocketUrl') {
                const url = createUrl(lcConfig);
                const webSocket = new WebSocket(url);

                webSocket.onopen = () => {
                    const socket = toSocket(webSocket);
                    const messageTransports = {
                        reader: new WebSocketMessageReader(socket),
                        writer: new WebSocketMessageWriter(socket)
                    };
                    this.handleLanguageClientStart(messageTransports, resolve, reject);
                };
            } else {
                if (!this.worker) {
                    if (lcConfig?.configType === 'WorkerConfig') {
                        const workerConfig = lcConfig as WorkerConfigOptions;
                        this.worker = new Worker(new URL(workerConfig.url, window.location.href).href, {
                            type: workerConfig.type,
                            name: workerConfig.name
                        });
                    } else {
                        const workerDirectConfig = lcConfig as WorkerConfigDirect;
                        this.worker = workerDirectConfig.worker;
                    }
                }
                const messageTransports = {
                    reader: new BrowserMessageReader(this.worker),
                    writer: new BrowserMessageWriter(this.worker)
                };
                this.handleLanguageClientStart(messageTransports, resolve, reject);
            }
        });
    }

    private async handleLanguageClientStart(messageTransports: MessageTransports,
        resolve: (value: string) => void,
        reject: (reason?: unknown) => void) {

        this.languageClient = this.createLanguageClient(messageTransports);
        const lcConfig = this.languageClientConfig?.options;
        messageTransports.reader.onClose(async () => {
            await this.languageClient?.stop();
            if ((lcConfig?.configType === 'WebSocket' || lcConfig?.configType === 'WebSocketUrl') && lcConfig?.stopOptions) {
                const stopOptions = lcConfig?.stopOptions;
                stopOptions.onCall();
                if (stopOptions.reportStatus) {
                    console.log(this.reportStatus().join('\n'));
                }
            }
        });

        try {
            await this.languageClient.start();
            if ((lcConfig?.configType === 'WebSocket' || lcConfig?.configType === 'WebSocketUrl') && lcConfig?.startOptions) {
                const startOptions = lcConfig?.startOptions;
                startOptions.onCall();
                if (startOptions.reportStatus) {
                    console.log(this.reportStatus().join('\n'));
                }
            }
        } catch (e) {
            const errorMsg = `monaco-languageclient start was unsuccessful: ${e}`;
            reject(errorMsg);
        }
        const msg = 'monaco-languageclient was successfully started.';
        resolve(msg);
    }

    private createLanguageClient(transports: MessageTransports): MonacoLanguageClient {
        return new MonacoLanguageClient({
            name: 'Monaco Wrapper Language Client',
            clientOptions: {
                // use a language id as a document selector
                documentSelector: [this.editorApp!.getAppConfig().languageId],
                // disable the default error handler
                errorHandler: {
                    error: () => ({ action: ErrorAction.Continue }),
                    closed: () => ({ action: CloseAction.DoNotRestart })
                },
                // allow to initialize the language client with user specific options
                initializationOptions: this.languageClientConfig?.initializationOptions
            },
            // create a language client connection from the JSON RPC connection on demand
            connectionProvider: {
                get: () => {
                    return Promise.resolve(transports);
                }
            }
        });
    }

}
