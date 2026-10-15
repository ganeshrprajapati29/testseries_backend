/**
 * Secure CLI for creating (or resetting) an administrator. Admin accounts can never be
 * created through the public API.
 *
 *   npm run create-admin -- --email admin@civilsansad.com --name "Site Admin" [--role superadmin]
 *
 * The password is read from the ADMIN_PASSWORD environment variable or prompted for
 * interactively (input hidden). It is never accepted as a command-line argument because
 * arguments end up in shell history and process listings.
 */
import { parseArgs } from 'node:util';
import readline from 'node:readline';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { createAdminAccount } from '../services/auth.service.js';
import { emailSchema, nameSchema, passwordSchema } from '../validators/auth.validator.js';
function promptHidden(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        const output = rl;
        let muted = false;
        output._writeToOutput = (s) => {
            if (!muted)
                process.stdout.write(s);
        };
        rl.question(question, (answer) => {
            rl.close();
            process.stdout.write('\n');
            resolve(answer);
        });
        muted = true;
    });
}
async function main() {
    const { values } = parseArgs({
        options: {
            email: { type: 'string' },
            name: { type: 'string', default: 'Administrator' },
            role: { type: 'string', default: 'superadmin' },
        },
    });
    const email = emailSchema.parse(values.email ?? '');
    const name = nameSchema.parse(values.name);
    const role = values.role === 'admin' ? 'admin' : 'superadmin';
    let password = process.env.ADMIN_PASSWORD ?? '';
    if (!password) {
        if (!process.stdin.isTTY)
            throw new Error('Set ADMIN_PASSWORD or run the command in an interactive terminal');
        password = await promptHidden('Admin password (min 8 chars, letters and numbers): ');
        const confirm = await promptHidden('Confirm password: ');
        if (password !== confirm)
            throw new Error('Passwords do not match');
    }
    const check = passwordSchema.safeParse(password);
    if (!check.success)
        throw new Error(check.error.issues.map((i) => i.message).join(', '));
    await connectDatabase();
    const { user, created } = await createAdminAccount({ name, email, password, role });
    console.log(`${created ? 'Created' : 'Updated'} ${role} account: ${user.email}`);
}
main()
    .catch((err) => {
    console.error(`Failed to create admin: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
})
    .finally(() => disconnectDatabase().catch(() => undefined));
//# sourceMappingURL=seedAdmin.js.map