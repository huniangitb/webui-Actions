// logParser.js

/**
 * @brief 解析 NDJSON 格式的日志内容。
 * @param {string} ndjsonContent NDJSON 格式的字符串日志内容。
 * @returns {Array<Object>} 解析后的日志条目数组。
 */
export function parseLogContent(ndjsonContent) {
    if (!ndjsonContent || ndjsonContent.trim() === '') return [];
    const parsedEntries = [];
    const lines = ndjsonContent.split('\n');
    lines.forEach(line => {
        if (line.trim() === '') return;
        try {
            const stats = JSON.parse(line);
            if (!stats.timestamp || !stats.global_stats) return;
            const formattedTimestamp = stats.timestamp.replace('T', ' ').replace('Z', '');
            const reclaimedSegments = (stats.gc_trim_stats?.reclaimed_segments) || 0;
            const trimmedMBValue = (stats.gc_trim_stats?.trimmed_mb) || 0;
            const parsedEntry = {
                timestamp: formattedTimestamp,
                date: stats.timestamp.split('T')[0],
                deletedFiles: stats.global_stats.files_deleted || 0,
                deletedDirs: stats.global_stats.dirs_deleted || 0,
                dirtySegments: reclaimedSegments,
                fileCleanedMB: stats.global_stats.megabytes_deleted || 0,
                trimMB: trimmedMBValue,
                appStats: stats.app_stats || []
            };
            parsedEntries.push(parsedEntry);
        } catch (error) {
            console.error("解析 JSON 行失败:", error, "行内容:", line);
        }
    });
    return parsedEntries;
}

/**
 * @brief 将新的日志数据合并到本地存储中，并去重、过滤。
 * @param {Array<Object>} newData 新的日志条目数组。
 */
export function updateLocalStorage(newData) {
    if (!newData || newData.length === 0) return;
    const storedData = JSON.parse(localStorage.getItem('logData') || '[]');
    const dataMap = new Map(storedData.map(entry => [entry.timestamp, entry]));
    newData.forEach(newEntry => dataMap.set(newEntry.timestamp, newEntry));
    const combinedData = Array.from(dataMap.values());
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 6);
    const filteredData = combinedData.filter(entry => new Date(entry.date) >= cutoffDate);
    localStorage.setItem('logData', JSON.stringify(filteredData));
}

/**
 * @brief 从本地存储中获取所有日志数据。
 * @returns {Array<Object>} 存储的日志条目数组。
 */
export function getStoredData() {
    return JSON.parse(localStorage.getItem('logData') || '[]');
}

/**
 * @brief 清除本地存储中的所有日志数据。
 */
export function clearStoredData() {
    localStorage.removeItem('logData');
}