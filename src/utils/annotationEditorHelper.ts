import { MarkdownView } from "obsidian";
import type { AnnotationColor, AnnotationRuby } from "../types";
import { scanAnnotationTags } from "../view/annotationTagParser";
import { buildMarkTag } from "../annotationFile/annotationSerializer";
import { AnnotationFileManager } from "../annotationFile/AnnotationFileManager";

// 去掉 <ruby> 标签，保留文本内容
function stripRubyTags(text: string): string {
	return text
		.replace(/<ruby\s+[^>]*>([\s\S]*?)<rt\s+[^>]*>[\s\S]*?<\/rt><\/ruby>/g, "$1");
}

// 编辑模式下用 replaceRange 局部替换标注
export async function editAnnotationInEditor(
	view: MarkdownView,
	fileManager: AnnotationFileManager,
	notePath: string,
	annotationId: string,
	action: 'delete' | {
		color: AnnotationColor;
		note?: string;
		rubyTexts?: AnnotationRuby[];
		isFullText?: boolean;
		isCrossBlock?: boolean;
	}
): Promise<boolean> {
	if (view.getMode() !== "source") return false;

	const doc = view.editor.getValue();
	const blocks = scanAnnotationTags(doc, 0, doc);
	const targetBlocks = blocks.filter(b => b.id === annotationId);
	if (targetBlocks.length === 0) return false;

	// 从后往前替换，避免偏移量变化影响前面的位置
	const sorted = [...targetBlocks].sort((a, b) => b.markOpenFrom - a.markOpenFrom);

	for (const block of sorted) {
		const from = view.editor.offsetToPos(block.markOpenFrom);
		const to = view.editor.offsetToPos(block.markCloseTo);

		if (action === 'delete') {
			// 删除：提取纯文本（去掉 mark 和 ruby 标签）
			const innerContent = doc.substring(block.markOpenTo, block.markCloseFrom);
			const plainText = stripRubyTags(innerContent);
			view.editor.replaceRange(plainText, from, to);
		} else {
			// 编辑：用新属性重建 mark 标签
			const innerContent = doc.substring(block.markOpenTo, block.markCloseFrom);
			const plainText = stripRubyTags(innerContent);
			const newTag = buildMarkTag(
				annotationId, plainText, action.color,
				action.note, action.rubyTexts,
				undefined, action.isFullText, action.isCrossBlock
			);
			view.editor.replaceRange(newTag, from, to);
		}
	}

	// 将编辑器新内容写回标注文件
	const newContent = view.editor.getValue();
	await fileManager.writeAnnotationFile(notePath, newContent);

	return true;
}
