import { z } from 'zod';

/** An SSH config alias, never a flag, shell fragment or remote command. */
export const SshAliasSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/);
