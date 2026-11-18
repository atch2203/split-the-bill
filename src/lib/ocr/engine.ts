export interface OcrEngine {
	name: string;
	recognize(img: ImageBitmap): Promise<string>;
}
