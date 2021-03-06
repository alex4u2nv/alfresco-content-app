import {Injectable} from '@angular/core';
import {AlfrescoApiService, LogService} from '@alfresco/adf-core';
import {RenditionEntry} from 'alfresco-js-api';
import {ContentApiService} from './content-api.service';

@Injectable()
export class ViewUtilService {
    static TARGET = '_new';

    /**
     * Content groups based on categorization of files that can be viewed in the web browser. This
     * implementation or grouping is tied to the definition the ng component: ViewerComponent
     * @type {{IMAGE: string; MEDIA: string; PDF: string; TEXT: string}}
     */
    public static ContentGroup = {
        IMAGE: 'image',
        MEDIA: 'media',
        PDF: 'pdf',
        TEXT: 'text'
    };

    /**
     * Based on ViewerComponent Implementation, this value is used to determne how many times we try
     * to get the rendition of a file for preview, or printing.
     * @type {number}
     */
    maxRetries = 5;

    /**
     * Mimetype grouping based on the ViewerComponent.
     * @type {{text: string[]; pdf: string[]; image: string[]; media: string[]}}
     */
    private mimeTypes = {
        text: ['text/plain', 'text/csv', 'text/xml', 'text/html', 'application/x-javascript'],
        pdf: ['application/pdf'],
        image: ['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/svg+xml'],
        media: ['video/mp4', 'video/webm', 'video/ogg', 'audio/mpeg', 'audio/ogg', 'audio/wav']
    };

    constructor(private apiService: AlfrescoApiService,
                private contentApi: ContentApiService,
                private logService: LogService) {
    }

    /**
     * This method takes a url to trigger the print dialog against, and the type of artifact that it
     * is.
     * This URL should be one that can be rendered in the browser, for example PDF, Image, or Text
     * @param {string} url
     * @param {string} type
     */
    public printFile(url: string, type: string) {
        const pwa = window.open(url, ViewUtilService.TARGET);
        // Because of the way chrome focus and close image window vs. pdf preview window
        if (type === ViewUtilService.ContentGroup.IMAGE) {
            pwa.onfocus = () => {
                setTimeout( () => {
                    pwa.close();
                }, 500);
            };
            pwa.onload = () => {
                pwa.print();
            };
        } else {
            pwa.onload = () => {
                pwa.print();
                pwa.onfocus =  () => {
                    setTimeout( () => {
                        pwa.close();
                    }, 10);
                };
            };
        }
    }

    /**
     * Launch the File Print dialog from anywhere other than the preview service, which resolves the
     * rendition of the object that can be printed from a web browser.
     * These are: images, PDFs, or PDF rendition of files.
     * We also force PDF rendition for TEXT type objects, otherwise the default URL is to download.
     * TODO there are different TEXT type objects, (HTML, plaintext, xml, etc. we should determine how these are handled)
     * @param {string} objectId
     * @param {string} objectType
     */
    public printFileGeneric(objectId: string, mimeType: string) {
        const nodeId = objectId;
        const type: string = this.getViewerTypeByMimeType(mimeType);

        this.getRendition(nodeId, ViewUtilService.ContentGroup.PDF)
        .then(value => {
            const url: string = this.getRenditionUrl(nodeId, type, (value ? true : false));
            const printType = (type === ViewUtilService.ContentGroup.PDF
                || type === ViewUtilService.ContentGroup.TEXT)
                ? ViewUtilService.ContentGroup.PDF : type;
            this.printFile(url, printType);
        })
        .catch(err => {
            this.logService.error('Error with Printing');
            this.logService.error(err);
        });
    }

    public getRenditionUrl(nodeId: string, type: string, renditionExists: boolean): string {
        return (renditionExists && type !== ViewUtilService.ContentGroup.IMAGE) ?
            this.apiService.contentApi.getRenditionUrl(nodeId, ViewUtilService.ContentGroup.PDF) :
            this.contentApi.getContentUrl(nodeId, false);
    }

    /**
     * From ViewerComponent
     * @param {string} nodeId
     * @param {string} renditionId
     * @param {number} retries
     * @returns {Promise<AlfrescoApi.RenditionEntry>}
     */
    private async waitRendition(nodeId: string, renditionId: string, retries: number): Promise<RenditionEntry> {
        const rendition = await this.apiService.renditionsApi.getRendition(nodeId, renditionId);

        if (this.maxRetries < retries) {
            const status = rendition.entry.status.toString();

            if (status === 'CREATED') {
                return rendition;
            } else {
                retries += 1;
                await this.wait(1000);
                return await this.waitRendition(nodeId, renditionId, retries);
            }
        }
    }


    /**
     * From ViewerComponent
     * @param {string} mimeType
     * @returns {string}
     */
    getViewerTypeByMimeType(mimeType: string) {
        if (mimeType) {
            mimeType = mimeType.toLowerCase();

            const editorTypes = Object.keys(this.mimeTypes);
            for (const type of editorTypes) {
                if (this.mimeTypes[type].indexOf(mimeType) >= 0) {
                    return type;
                }
            }
        }
        return 'unknown';
    }

    /**
     * From ViwerComponent
     * @param {number} ms
     * @returns {Promise<any>}
     */
    public wait(ms: number): Promise<any> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * From ViewerComponent
     * @param {string} nodeId
     * @returns {string}
     */
    public async getRendition(nodeId: string, renditionId: string): Promise<RenditionEntry> {
        const supported = await this.apiService.renditionsApi.getRenditions(nodeId);
        let rendition = supported.list.entries.find(obj => obj.entry.id.toLowerCase() === renditionId);

        if (rendition) {
            const status = rendition.entry.status.toString();

            if (status === 'NOT_CREATED') {
                try {
                    await this.apiService.renditionsApi.createRendition(nodeId, {id: renditionId});
                    rendition = await this.waitRendition(nodeId, renditionId, 0);
                } catch (err) {
                    this.logService.error(err);
                }
            }
        }
        return new Promise(resolve => resolve(rendition));
    }

}
