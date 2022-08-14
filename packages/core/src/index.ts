import type { Innertube } from 'youtubei.js';
import VideoInfo from 'youtubei.js/dist/src/parser/youtube/VideoInfo';

export type FrameExtractor = (segmentUrl: string) => Promise<HTMLCanvasElement>;
export interface Overlay {
    // in percentages
    x: number;
    y: number;
    width: number;
    height: number;
    // content
    content: OverlayText | OverlayImage;
}
export interface OverlayText {
    type: 'text';
    value: OverlayTextRun | OverlayScript;
    style: {
        stroke?: boolean;
        font?: string,
        strokeStyle?: string,
        fillStyle?: string,
    };
}

export interface OverlayScript {
    type: 'script';
    body: string;
}

export interface OverlayTextRun {
    type: 'run';
    value: string;
}

export interface OverlayImage {
    type: 'image';
    url: string;
    fit?: 'contain' | 'cover';
}

type FetchImage = (url: string) => Promise<HTMLImageElement>;

type GetImageBuffer = (image: HTMLCanvasElement) => Promise<Uint8Array>;

export default class ThumbnailManager {
    #yt;
    #frame_extractor;
    #get_image;
    #get_image_buffer;
    video_info?: VideoInfo;
    #handle: any;

    constructor(yt: Innertube, frame_extractor: FrameExtractor, get_image: FetchImage, get_image_buffer: GetImageBuffer) {
        this.#yt = yt;
        this.#frame_extractor = frame_extractor;
        this.#get_image = get_image;
        this.#get_image_buffer = get_image_buffer;
    }

    async setVideoId(video_id: string) {
        this.video_info = await this.#yt.getInfo(video_id);
    }

    async getThumbnail(video_id: string) {
        if (!this.video_info) {
            await this.setVideoId(video_id);
        }

        if (!this.video_info) 
            throw new Error('Unreachable');

        if (!this.video_info.basic_info.is_live_content) 
            throw new Error('Not a live stream');

        const manifest_url = this.video_info.streaming_data?.dash_manifest_url;

        if (typeof manifest_url !== 'string')
            throw new Error('No manifest url');

        const manifest = await this.#yt.session.http.fetch_function(manifest_url);

        if (!manifest.ok)
            throw new Error('Manifest fetch failed');

        const root = new DOMParser().parseFromString(await manifest.text(), 'text/xml');

        const video_set = root.querySelector('AdaptationSet[mimeType="video/mp4"]');

        if (!video_set)
            throw new Error('Could not find video AdaptationSet');

        const representations = Array.from(video_set.querySelectorAll('Representation'));

        if (!representations.length)
            throw new Error('Could not find any Representation');

        const [best] = representations.sort((a, b) => {
            const awidth = parseInt(a.getAttribute('width') || '-1');
            const bwidth = parseInt(b.getAttribute('width') || '-1');
            return bwidth - awidth;
        });

        const base_url_element = best.querySelector('BaseURL');

        if (!base_url_element)
            throw new Error('Could not find BaseURL');

        const segment_list = best.querySelector('SegmentList');

        if (!segment_list)
            throw new Error('Could not find SegmentList');

        const last_segment = segment_list.lastChild as Element;

        if (!last_segment)
            throw new Error('Could not find last Segment');

        const base_url = base_url_element.textContent;
        const last_segment_url_fragment = last_segment.getAttribute('media');

        if (typeof last_segment_url_fragment !== 'string' || typeof base_url !== 'string')
            throw new Error('Could not find last segment url');

        const last_segment_url = `${base_url}${last_segment_url_fragment}`;

        return await this.#frame_extractor(last_segment_url);
    }

    async applyOverlays(ctx: CanvasRenderingContext2D, overlays: Overlay[] = []) {
        for (const overlay of overlays) {
            const { x, y, width, height } = overlay;
            const 
                c_x = x * ctx.canvas.width,
                c_y = y * ctx.canvas.height,
                c_width = width * ctx.canvas.width,
                c_height = height * ctx.canvas.height;
            
            switch (overlay.content.type) {
                case 'image':
                {
                    const { url, fit } = overlay.content;
                    const img = await this.#get_image(url);
                    if (fit === 'contain') {
                        const ratio = Math.min(c_width / img.width, c_height / img.height);
                        ctx.drawImage(img, c_x, c_y, img.width * ratio, img.height * ratio);
                    }
                    else {
                        ctx.drawImage(img, c_x, c_y, c_width, c_height);
                    }
                }
                break;
            
                case 'text':
                {
                    const { value } = overlay.content;
                    const { font, strokeStyle, fillStyle, stroke } = overlay.content.style;
                    font && (ctx.font = font);
                    strokeStyle && (ctx.strokeStyle = strokeStyle);
                    fillStyle && (ctx.fillStyle = fillStyle);
                    ctx.font

                    const str = value.type === 'script' ? new Function('VideoInfo', value.body)(this.video_info) : value.value;

                    if (typeof str !== 'string')
                        throw new TypeError('Overlay text value is not a string');

                    stroke ? ctx.strokeText(str, c_x, c_y) : ctx.fillText(str, c_x, c_y);
                }   
                break;

                default:
                    throw new Error('Unsupported content type');
            }
        }
    }

    async update() {
        const id = this.video_info?.basic_info.id;
        if (!id)
            throw new Error('Video info is not loaded. Did you forget to call setVideoId?');
        
        const thumbnail = await this.getThumbnail(id);
        const ctx = thumbnail.getContext('2d');

        if (!ctx)
            throw new Error('Could not get rendering context');

        this.applyOverlays(ctx, []);

        const data = await this.#get_image_buffer(thumbnail);

        if (!data)
            throw new Error('Could not get image buffer');

        const res = await this.#yt.studio.setThumbnail(id, data);

        if (!res.success)
            console.error('Could not upload thumbnail');
        else
            console.log('Thumbnail updated at ' + new Date().toTimeString());
    }

    loop(rate: number) {
        if (rate < 5) 
            throw new TypeError('Delay must be greater than or equal to 5 seconds');

        const loop_cb = async () => {
            await this.update();

            this.#handle = setTimeout(loop_cb, rate);
        }

        loop_cb();
    }

    stop() {
        clearTimeout(this.#handle);
        this.#handle = undefined;
    }
}
