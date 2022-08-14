import { Command } from "commander"; 
import chalk from 'chalk';
import open from 'open';
import ora, { Ora } from 'ora';
import * as pkg from 'youtubei.js/dist/index.js';
import { fileURLToPath } from "url";
import { exit } from "process";
import ThumbnailManager from '@dy-thumb/core';
import {DOMParser} from 'linkedom';
// @ts-ignore
globalThis.DOMParser = DOMParser;
// @ts-ignore
const Innertube = pkg.default.default as typeof pkg.Innertube;
// @ts-ignore
const UniversalCache = pkg.default.UniversalCache as typeof pkg.UniversalCache;

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const yt = await Innertube.create({
    cache: new UniversalCache(true)
});

const program = new Command();

program
    .name('dynamic-yt-thumbs')
    .description('Dynamic YouTube live thumbnails')
    .version('0.0.1');

program.command('login')
    .description('Login to YouTube via OAuth')
    .action(async () => {
        let spinner: Ora | undefined = ora('Getting OAuth user code...').start();

        yt.session.once('auth-pending', data => {
            if (!spinner) return console.log('unexpected auth-pending event');
            spinner.text = 'Ready to authenticate';
            spinner.succeed();
            console.log(`Visit ${chalk.blue(data.verification_url)} and use the code ${chalk.blue(chalk.bold(data.user_code))} to authenticate.`);
            spinner = ora('Waiting for authentication...').start();
            open(data.verification_url).catch(() => {})
        });

        yt.session.once('auth', async () => {
            if (!spinner) return console.log('Authentication successful');

            await yt.session.oauth.cacheCredentials();

            spinner.text = 'Authentication successful';
            spinner.succeed();
        })

        await yt.session.signIn();
    });

program.command('logout')
    .description('Logout of YouTube')
    .action(async () => {
        let spinner: Ora | undefined = ora('Checking login status...').start();

        yt.session.once('auth-pending', data => {
            if (!spinner) return console.log('unexpected auth-pending event');
            spinner.text = 'Not logged in';
            spinner.fail();
            exit(1);
        });

        // XXX: This order is important
        const promise = yt.session.signIn();

        yt.session.once('auth', async () => {
            await yt.session.signOut();
            if (!spinner) return console.log('Logout successful');
            spinner.text = 'Logout successful';
            spinner.succeed();
        })

        await promise;
    });

program.command('start')
    .argument('<videoId>', 'ID of the stream')
    .argument('[config]', 'Path to a configuration file')
    .description('Start generating thumbnails for a stream')
    .action(async (videoId: string, config: string) => {
        let spinner: Ora | undefined = ora('Checking login status...').start();

        yt.session.once('auth-pending', data => {
            if (!spinner) return console.log('unexpected auth-pending event');
            spinner.text = 'Not logged in';
            spinner.fail();
            exit(1);
        });

        // XXX: This order is important
        const promise = yt.session.signIn();

        yt.session.once('auth', async () => {
            await yt.session.signOut();
            if (!spinner) return console.log('Logged in');
            spinner.text = 'Fetching video info...';
            
            const manager = new ThumbnailManager(
                yt,
                (segmentUrl: string) => {
                    
                },
                (url: string) => {

                },
                (image: HTMLCanvasElement) => {

                }
            );

            await manager.setVideoId(videoId);

            spinner.text = `Stream "${manager.video_info?.basic_info.title}" information loaded`;

            await manager.loop()
        })

        await promise;
    })

program.parse();
