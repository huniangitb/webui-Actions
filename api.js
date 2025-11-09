// api.js
import { exec } from 'kernelsu';

/**
 * @brief 检查后端 'cleaner' 进程是否存在。
 * @returns {Promise<boolean>}
 */
export async function checkBackendProcess() {
    try {
        const { errno } = await exec('pgrep cleaner');
        return errno === 0;
    } catch (e) {
        return false;
    }
}

/**
 * @brief 向后端发送 TCP 命令。
 * @param {string} command 要发送的命令。
 * @returns {Promise<Object|Array|null>} 解析后的 JSON 响应。
 * @throws {Error} 当通信失败或响应解析失败时抛出异常。
 */
export async function sendTcpCommand(command) {
    try {
        const { errno, stdout, stderr } = await exec(`/data/adb/modules/Clean-C/tcp_client ${command}`);
        if (errno !== 0) {
            throw new Error(`命令发送失败: ${stderr}`);
        }
        if (!stdout.trim()) {
            return [];
        }
        try {
            return JSON.parse(stdout.trim());
        } catch (e) {
            throw new Error('后端响应解析失败');
        }
    } catch (error) {
        throw new Error(`后端通信异常: ${error.message}`);
    }
}