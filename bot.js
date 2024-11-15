const fs = require('fs');
const axios = require('axios');
const colors = require('colors');
const { DateTime } = require('luxon');
const { parse } = require('querystring');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');

class Timefarm {
    constructor() {
        this.headers = {
            'Accept': '*/*',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5',
            'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-site',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        };
    }

    setAuthorization(auth) {
        this.headers['Authorization'] = `Bearer ${auth}`;
    }

    delAuthorization() {
        delete this.headers['Authorization'];
    }

    loadToken(id) {
        const tokens = JSON.parse(fs.readFileSync('token.json', 'utf8'));
        return tokens[id] || null;
    }

    saveToken(id, token) {
        const tokens = JSON.parse(fs.readFileSync('token.json', 'utf8'));
        tokens[id] = token;
        fs.writeFileSync('token.json', JSON.stringify(tokens, null, 4), 'utf8');
    }

    async login(data) {
        const url = 'https://tg-bot-tap.laborx.io/api/v1/auth/validate-init/v2';
        const cleanedData = data.replace(/\r/g, '');
        const requestData = {
            initData: cleanedData,
            platform: 'android'
        };
        
        this.delAuthorization();
        try {
            const res = await axios.post(url, requestData, { headers: this.headers });
            if (res.status !== 200) {
                this.log(colors.red(`Login failed! Status code: ${res.status}`));
                return null;
            }
            const token = res.data.token;
            this.log(colors.green(`Login successful!`));
            return token;
        } catch (error) {
            this.log(colors.red(`Error during login: ${error.message}`));
            return null;
        }
    }

    async endFarming() {
        const url = 'https://tg-bot-tap.laborx.io/api/v1/farming/finish';
        try {
            const response = await axios.post(url, {}, {
                headers: this.headers
            });

            const balance = response.data.balance;
            this.log(colors.green(`Successfully claimed. Balance: ${balance}`));
            await this.startFarming();
        } catch (error) {
            this.log(colors.red('Unable to claim:'));
        }
    }

    async startFarming() {
        const url = 'https://tg-bot-tap.laborx.io/api/v1/farming/start';
        try {
            const response = await axios.post(url, {}, {
                headers: this.headers
            });
            this.log(colors.green('Farming started successfully.'));
        } catch (error) {
            this.log(colors.red('Unable to start farming:'));
        }
    }
    
    async upgradeWatch() {
        const url = 'https://tg-bot-tap.laborx.io/api/v1/me/level/upgrade';
        try {
            const response = await axios.post(url, {}, { headers: this.headers });
            const { level, balance } = response.data;
            this.log(colors.green(`Successfully upgraded watch to level ${level}, balance ${balance}`));
        } catch (error) {
            this.log(colors.red('Insufficient balance to upgrade watch'));
        }
    }

    async getTasks() {
        const url = 'https://tg-bot-tap.laborx.io/api/v1/tasks';
        try {
            const response = await axios.get(url, { headers: this.headers });
            const tasks = response.data;
            
            for (const task of tasks) {
                if (task.type !== 'ADSGRAM' && task.type !== 'TADS') {
                    if (!task.submission || task.submission.status === 'REJECTED') {
                        await this.submitTask(task.id, task.title, task.reward);
                    } else if (task.submission.status === 'COMPLETED') {
                        await this.claimTask(task.id, task.title, task.submission.reward);
                    }
                }
            }
        } catch (error) {
            this.log(colors.red(`Error fetching tasks: ${error.message}`));
        }
    }

    async submitTask(taskId, taskTitle, taskReward) {
        const url = `https://tg-bot-tap.laborx.io/api/v1/tasks/${taskId}/submissions`;
        try {
            const response = await axios.post(url, {}, { headers: this.headers });
            
            if (response.data.result.status === 'COMPLETED') {
                await this.claimTask(taskId, taskTitle, taskReward);
            }
        } catch (error) {
            if (error.response && error.response.status === 400) {
                if (error.response.data.error.message === 'Already submitted') {
                    this.log(colors.yellow(`${taskTitle} already submitted`));
                }
            } else {
                this.log(colors.red(`Error submitting task ${taskTitle}: ${error.message}`));
            }
        }
    }

    async claimTask(taskId, taskTitle, taskReward) {
        const url = `https://tg-bot-tap.laborx.io/api/v1/tasks/${taskId}/claims`;
        try {
            const response = await axios.post(url, {}, { headers: this.headers });
            this.log(colors.green(`Received ${taskReward} $SECOND from ${taskTitle}`));
        } catch (error) {
            if (error.response && error.response.status === 400) {
                if (error.response.data.error.message === 'Failed to claim reward') {
                    this.log(colors.yellow(`Failed to claim ${taskTitle}`));
                }
            } else {
                this.log(colors.red(`Error claiming task ${taskTitle}: ${error.message}`));
            }
        }
    }
    
    async getBalance(upgradeWatch, processTasks) {
        const url = 'https://tg-bot-tap.laborx.io/api/v1/farming/info';
        while (true) {
            try {
                const res = await axios.get(url, { headers: this.headers });
                const data = res.data;
                if (!data) {
                    this.log(colors.red('Failed to fetch data'));
                    console.log('Error details:', res.data);
                    return null;
                }
                const timestamp = DateTime.fromISO(data.activeFarmingStartedAt).toMillis() / 1000;
                const currentTime = Math.floor(Date.now() / 1000);
                const balance = data.balance;
                this.log(colors.green('Balance : ') + colors.white(balance));

                if (!data.activeFarmingStartedAt) {
                    this.log(colors.yellow('Farming not started.'));
                    await this.startFarming();
                    continue;
                }

                if (upgradeWatch) {
                    await this.upgradeWatch();
                }

                // Process tasks if enabled
                if (processTasks) {
                    await this.getTasks();
                }

                const endFarming = timestamp + data.farmingDurationInSec;
                const formatEndFarming = DateTime.fromMillis(endFarming * 1000).toISO().split('.')[0];
                if (currentTime > endFarming) {
                    await this.endFarming();
                    continue;
                }
                this.log(colors.yellow('Farming completion time: ') + colors.white(formatEndFarming));
                let next = Math.floor(endFarming - currentTime);
                next += 120;
                return next;
            } catch (error) {
                this.log(colors.red('Connection error or query failed'));
                await this.countdown(60); 
            }
        }
    }

    async countdown(t) {
        for (let i = t; i > 0; i--) {
            const hours = String(Math.floor(i / 3600)).padStart(2, '0');
            const minutes = String(Math.floor((i % 3600) / 60)).padStart(2, '0');
            const seconds = String(i % 60).padStart(2, '0').split('.')[0];
            process.stdout.write(colors.white(`[*] Waiting ${hours}:${minutes}:${seconds}     \r`));
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        process.stdout.write('\r');
    }

    log(msg) {
        if (isMainThread) {
            console.log(`[*] ${msg}`);
        } else {
            parentPort.postMessage({
                type: 'log',
                data: `[*] ${msg}`
            });
        }
    }

    async askQuestion(rl, question) {
        return new Promise(resolve => {
            rl.question(question, answer => {
                resolve(answer);
            });
        });
    }

    chunkArray(array, chunks) {
        const result = [];
        const chunkSize = Math.ceil(array.length / chunks);
        
        for (let i = 0; i < array.length; i += chunkSize) {
            result.push(array.slice(i, i + chunkSize));
        }
        
        return result;
    }

    async main() {
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });

        try {
            // Ask all questions before starting
            const upgradeWatch = await this.askQuestion(readline, 'Do you want to upgrade the watch? (y/n) ');
            const processTasks = await this.askQuestion(readline, 'Do you want to process tasks? (y/n) ');
            const threadCount = parseInt(await this.askQuestion(readline, 'Enter the number of threads (1-10): '));

            if (isNaN(threadCount) || threadCount < 1 || threadCount > 100) {
                console.log(colors.red('Invalid thread count. Using 1 thread.'));
                threadCount = 1;
            }

            readline.close();

            const args = require('yargs').argv;
            const dataFile = args.data || 'data.txt';
            const datas = fs.readFileSync(dataFile, 'utf8')
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0 && decodeURIComponent(line).includes('user='));

            if (datas.length <= 0) {
                console.log(colors.red(`No data found`));
                process.exit();
            }

            // Create token.json if it doesn't exist
            if (!fs.existsSync('token.json')) {
                fs.writeFileSync('token.json', '{}', 'utf8');
            }

            // Split data into chunks for each thread
            const dataChunks = this.chunkArray(datas, threadCount);
            const workers = [];
            const workerData = {
                upgradeWatch: upgradeWatch.toLowerCase() === 'y',
                processTasks: processTasks.toLowerCase() === 'y'
            };

            console.log(colors.cyan(`Starting ${threadCount} threads...`));

            // Create and start workers
            for (let i = 0; i < dataChunks.length; i++) {
                const worker = new Worker(__filename, {
                    workerData: {
                        ...workerData,
                        threadId: i + 1,
                        accounts: dataChunks[i]
                    }
                });

                worker.on('message', (message) => {
                    if (message.type === 'log') {
                        console.log(colors.cyan(`[Thread ${i + 1}]`), message.data);
                    }
                });

                worker.on('error', (error) => {
                    console.error(colors.red(`Thread ${i + 1} error:`), error);
                });

                worker.on('exit', (code) => {
                    if (code !== 0) {
                        console.error(colors.red(`Thread ${i + 1} stopped with exit code ${code}`));
                    }
                });

                workers.push(worker);
            }

            // Wait for all workers to complete
            await Promise.all(workers.map(worker => {
                return new Promise((resolve) => {
                    worker.on('exit', resolve);
                });
            }));

        } catch (error) {
            console.error(error);
            readline.close();
            process.exit(1);
        }
    }

    async workerProcess(accounts, threadId, config) {
        while (true) {
            const listCountdown = [];
            const start = Math.floor(Date.now() / 1000);

            for (let i = 0; i < accounts.length; i++) {
                const data = accounts[i];
                const parser = parse(data);
                const user = JSON.parse(parser.user);
                const id = user.id;
                const username = user.first_name;

                this.log(`========== Account ${i + 1} | ${username.green} ==========`);

                let token = this.loadToken(id);
                if (!token) {
                    this.log(colors.red('Unable to read token, sending login request!'));
                    token = await this.login(data);
                    if (token) {
                        this.saveToken(id, token);
                        this.setAuthorization(token);
                    } else {
                        continue;
                    }
                } else {
                    this.setAuthorization(token);
                }

                const result = await this.getBalance(config.upgradeWatch, config.processTasks);
                await this.countdown(3);
                listCountdown.push(result);
            }

            const end = Math.floor(Date.now() / 1000);
            const total = end - start;
            const min = Math.min(...listCountdown) - total;
            await this.countdown(min);
        }
    }
}

// Worker thread handling
if (!isMainThread) {
    const app = new Timefarm();
    app.workerProcess(
        workerData.accounts,
        workerData.threadId,
        {
            upgradeWatch: workerData.upgradeWatch,
            processTasks: workerData.processTasks
        }
    ).catch(error => {
        console.error(error);
        process.exit(1);
    });
} else {
    // Main thread
    (async () => {
        try {
            const app = new Timefarm();
            await app.main();
        } catch (error) {
            console.error(error);
            process.exit(1);
        }
    })();
}

// Export the class for use in other files if needed
module.exports = Timefarm;
