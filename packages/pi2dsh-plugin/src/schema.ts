import { Type, type TSchema } from 'typebox';

export type ToolDescriptorLike = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/**
 * Pi registerTool expects a TypeBox TSchema.
 * Catalog descriptors store plain JSON Schema — wrap with Type.Unsafe.
 */
export function descriptorToTypeBox(descriptor: ToolDescriptorLike): TSchema {
  const schema = descriptor.parameters ?? { type: 'object', properties: {} };
  return Type.Unsafe(schema as object);
}

export function toolLabel(name: string): string {
  return name
    .replace(/^(ops|cr)_/, '')
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}
