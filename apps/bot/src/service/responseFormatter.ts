/**
 * ResponseFormatter — formats LLM output into Discord-compatible messages.
 *
 * Handles message splitting at natural boundaries, command block formatting,
 * and ensures all chunks respect Discord's 2000-char message limit.
 */

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface FormattedResponse {
  chunks: string[];
  hasRelatedCommands: boolean;
}

export interface CommandDoc {
  name: string;
  label: string;
  description: string;
  category: string;
  usage: string;
  examples: string[];
  permissions: {
    user: string[];
    client: string[];
  };
  premium: boolean;
  subcommands: string[];
  keywords: string[];
  aliases: string[];
  relatedCommands: string[];
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const DISCORD_MAX_LENGTH = 2000;

// ─── ResponseFormatter ─────────────────────────────────────────────────────────

export class ResponseFormatter {
  /**
   * Format a command-focused response, optionally appending a structured
   * command block derived from the provided CommandDoc.
   */
  formatCommandResponse(text: string, command?: CommandDoc): FormattedResponse {
    let content = text;

    if (command) {
      const block = this.formatCommandBlock(command);
      content = content ? `${content}\n\n${block}` : block;
    }

    const chunks = this.splitMessage(content);
    const hasRelatedCommands = command
      ? command.relatedCommands.length > 0
      : false;

    return { chunks, hasRelatedCommands };
  }

  /**
   * Build a structured Discord markdown block for a command.
   *
   * Format:
   * **command_name**
   * description
   *
   * **Usage**
   * `usage_syntax`
   *
   * **Example**
   * `example1`
   * `example2`
   *
   * **Permissions**
   * You need: `perm1`, `perm2`
   * Bot needs: `perm3`, `perm4`
   *
   * **Related Commands**
   * `related1`, `related2`, `related3`
   */
  formatCommandBlock(doc: CommandDoc): string {
    const lines: string[] = [];

    // Header
    lines.push(`**${doc.name}**`);
    lines.push(doc.description);

    // Usage
    if (doc.usage) {
      lines.push("");
      lines.push("**Usage**");
      lines.push(`\`${doc.usage}\``);
    }

    // Examples
    if (doc.examples.length > 0) {
      lines.push("");
      lines.push("**Example**");
      for (const example of doc.examples) {
        lines.push(`\`${example}\``);
      }
    }

    // Permissions
    if (doc.permissions.user.length > 0 || doc.permissions.client.length > 0) {
      lines.push("");
      lines.push("**Permissions**");
      if (doc.permissions.user.length > 0) {
        const userPerms = doc.permissions.user
          .map((p) => `\`${p}\``)
          .join(", ");
        lines.push(`You need: ${userPerms}`);
      }
      if (doc.permissions.client.length > 0) {
        const clientPerms = doc.permissions.client
          .map((p) => `\`${p}\``)
          .join(", ");
        lines.push(`Bot needs: ${clientPerms}`);
      }
    }

    // Related Commands (up to 3)
    if (doc.relatedCommands.length > 0) {
      lines.push("");
      lines.push("**Related Commands**");
      const related = doc.relatedCommands
        .slice(0, 3)
        .map((c) => `\`${c}\``)
        .join(", ");
      lines.push(related);
    }

    return lines.join("\n");
  }

  /**
   * Split text at natural boundaries, preserving markdown and code blocks.
   *
   * Strategy (in order of preference):
   * 1. Split at double newlines (\n\n)
   * 2. Split at single newlines (\n)
   * 3. Split at spaces
   * 4. Hard split (last resort for very long tokens)
   *
   * Code blocks (``` ... ```) are never split mid-block.
   */
  splitMessage(text: string, maxLength: number = DISCORD_MAX_LENGTH): string[] {
    if (!text) return [""];
    if (text.length <= maxLength) return [text];

    // First, break text into segments that respect code blocks
    const segments = this.extractCodeBlockSegments(text);

    const chunks: string[] = [];
    let currentChunk = "";

    for (const segment of segments) {
      // If adding this segment fits, just append
      if (currentChunk.length + segment.length <= maxLength) {
        currentChunk += segment;
        continue;
      }

      // If the segment itself exceeds maxLength and it's a code block,
      // we need to flush current and add the code block as-is (it's atomic)
      if (segment.startsWith("```") && segment.length > maxLength) {
        if (currentChunk) {
          chunks.push(currentChunk.trimEnd());
          currentChunk = "";
        }
        // Force-split the code block at line boundaries
        const codeLines = segment.split("\n");
        let codeChunk = "";
        for (const line of codeLines) {
          if (
            codeChunk.length + line.length + 1 > maxLength &&
            codeChunk.length > 0
          ) {
            chunks.push(codeChunk.trimEnd());
            codeChunk = "";
          }
          codeChunk += (codeChunk ? "\n" : "") + line;
        }
        if (codeChunk) {
          currentChunk = codeChunk;
        }
        continue;
      }

      // If the segment is a code block that fits on its own, flush and start new
      if (segment.startsWith("```")) {
        if (currentChunk) {
          chunks.push(currentChunk.trimEnd());
          currentChunk = "";
        }
        currentChunk = segment;
        continue;
      }

      // Regular text segment — split it at natural boundaries
      const splitText = currentChunk + segment;
      const splitResult = this.splitAtBoundaries(splitText, maxLength);

      // All but the last piece are complete chunks
      for (let i = 0; i < splitResult.length - 1; i++) {
        chunks.push(splitResult[i]!.trimEnd());
      }
      currentChunk = splitResult[splitResult.length - 1] ?? "";
    }

    if (currentChunk) {
      chunks.push(currentChunk.trimEnd());
    }

    // Final pass: ensure every chunk respects maxLength (hard split if needed)
    const finalChunks: string[] = [];
    for (const chunk of chunks) {
      if (chunk.length <= maxLength) {
        finalChunks.push(chunk);
      } else {
        // Hard split as last resort
        for (let i = 0; i < chunk.length; i += maxLength) {
          finalChunks.push(chunk.slice(i, i + maxLength));
        }
      }
    }

    return finalChunks.length > 0 ? finalChunks : [""];
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  /**
   * Extract code block segments so they are treated as atomic units.
   * Returns an array of segments — alternating between text and code blocks.
   */
  private extractCodeBlockSegments(text: string): string[] {
    const segments: string[] = [];
    const codeBlockRegex = /```[\s\S]*?```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      // Text before the code block
      if (match.index > lastIndex) {
        segments.push(text.slice(lastIndex, match.index));
      }
      // The code block itself
      segments.push(match[0]);
      lastIndex = match.index + match[0].length;
    }

    // Remaining text after last code block
    if (lastIndex < text.length) {
      segments.push(text.slice(lastIndex));
    }

    return segments;
  }

  /**
   * Split text at natural boundaries (double newlines, single newlines, spaces).
   * Returns an array where each element is ≤ maxLength.
   */
  private splitAtBoundaries(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];

    // Try splitting at double newlines first
    const doubleNewlineSplit = this.splitAtDelimiter(text, "\n\n", maxLength);
    if (doubleNewlineSplit) return doubleNewlineSplit;

    // Try splitting at single newlines
    const singleNewlineSplit = this.splitAtDelimiter(text, "\n", maxLength);
    if (singleNewlineSplit) return singleNewlineSplit;

    // Try splitting at spaces
    const spaceSplit = this.splitAtDelimiter(text, " ", maxLength);
    if (spaceSplit) return spaceSplit;

    // Hard split — no natural boundary found
    const result: string[] = [];
    for (let i = 0; i < text.length; i += maxLength) {
      result.push(text.slice(i, i + maxLength));
    }
    return result;
  }

  /**
   * Attempt to split text using a specific delimiter, keeping chunks under maxLength.
   * Returns null if the strategy cannot produce valid chunks (e.g., a single token > maxLength).
   */
  private splitAtDelimiter(
    text: string,
    delimiter: string,
    maxLength: number,
  ): string[] | null {
    const parts = text.split(delimiter);
    const result: string[] = [];
    let current = "";

    for (const part of parts) {
      const candidate = current
        ? current + delimiter + part
        : part;

      if (candidate.length <= maxLength) {
        current = candidate;
      } else {
        if (current) {
          result.push(current);
        }
        // If a single part exceeds maxLength, this delimiter strategy fails
        if (part.length > maxLength) {
          return null;
        }
        current = part;
      }
    }

    if (current) {
      result.push(current);
    }

    return result.length > 0 ? result : null;
  }
}
