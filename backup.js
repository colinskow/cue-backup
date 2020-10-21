const puppeteer = require('puppeteer');
const https = require('https');
const http = require('https');
const { URL } = require('url');
const path = require('path');
const fse = require('fs-extra');
const PromisePool = require('@mixmaxhq/promise-pool');
const { file } = require('tmp-promise');

const DL_CONCURRENCY = 6;
const DL_THROTTLE = 1000;
const DEFAULT_SITE_CODED = 'bup.nonaq';
const BASE_DIR = './www';

const downloaded = new Set();

async function main() {
  let site;
  if (process.argv[2]) {
    if (!process.argv[2].match(/^https?:\/\//)) {
      console.log(`${process.argv[2]} is not a valid website. Must start with 'https://'`);
      return;
    }
    site = process.argv[2];
  } else {
    site = getDefaultSite();
  }
  console.log(`Backing up ${site}`);
  await backup(site);
}

async function backup(site) {
  const baseUrl = new URL(getDefaultSite());
  const siteUrl = new URL(site);
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setRequestInterception(true);

  page.on('request', (request) => {
    if (request.url().startsWith('data:') || downloaded.has(request.url())) {
      return request.continue();
    }
    const urlObj = new URL(request.url());
    const paths = urlObj.pathname.split('/');
    if (paths[0] === 'data' && paths[1] === 'media') {
      request.abort();
    } else {
      request.continue();
    }
  });

  page.on('response', async (response) => {
    if (response.url().startsWith('data:')) {
      return;
    }
    try {
      downloaded.add(response.url());
      const url = new URL(response.url());
      const filePath = getFilePath(url, siteUrl);
      const resourceType = response.request().resourceType();
      if (resourceType === 'document') {
        await saveDoc(await response.text(), filePath, baseUrl);
      } else {
        await fse.outputFile(filePath, await response.buffer());
      }
      console.log(response.url());
    } catch (err) {
      console.error(err);
    }
  });

  try {
    await savePage(page, site, siteUrl);
    const allPostsPage = new URL('/index2.html', site).toString();
    await savePage(page, allPostsPage, siteUrl)
    const proofsUrl = new URL('/data/proofs/', site).toString();
    await saveProofs(page, proofsUrl, siteUrl);
    console.log('BACKUP COMPLETE! Type `npm start` to launch the web server.');
    await browser.close();
  } catch (err) {
    console.error(err);
  }
}

async function savePage(page, url, siteUrl) {
  await page.goto(url, {
    waitUntil: ['load', 'networkidle0'],
    timeout: 30000
  });
  const hrefs = await getImageLinks(page);
  await downloadAll(hrefs, siteUrl);
}

async function saveProofs(page, url, siteUrl) {
  await page.goto(url, {
    waitUntil: ['load', 'networkidle0'],
    timeout: 30000
  });
  const hrefs = await getProofLinks(page);
  await downloadAll(hrefs, siteUrl);
}

function getFilePath(url, siteUrl) {
  let pathName = url.pathname;
  if (pathName.endsWith('/')) {
    pathName += 'index.html';
  }
  if (url.hostname == siteUrl.hostname) {
    return path.join(BASE_DIR, pathName);
  } else {
    return path.join(BASE_DIR, url.hostname, pathName);
  }
}

async function saveDoc(html, filePath, baseUrl) {
  html = fixPageLinks(html, baseUrl);
  return fse.outputFile(filePath, html);
}

function fixPageLinks(html, baseUrl) {
  // Change absolute links in the header to relative
  const hrefRegex = /(onclick="location.href=')(.+)(')/g;
  let output = html;
  output = output.replace(hrefRegex, (match, pre, link, post) => {
    const href = new URL(link, baseUrl);
    const relative = href.pathname + href.search + href.hash;
    return pre + relative + post;
  });
  
  // Change external links in script tags to local ones
  const scriptRegex = /(\<script\ssrc=")(.+)(")/g;
  output = output.replace(scriptRegex, (match, pre, src, post) => {
    const href = new URL(src, baseUrl);
    const relative = href.pathname + href.search + href.hash;
    if (href.hostname === baseUrl.hostname) {
      return pre + relative + post;
    }
    return pre + '/' + href.hostname + relative + post;
  });
  return output;
}

async function getImageLinks(page) {
  const handles = await page.$$('article a.download');
  const hrefHandles = await Promise.all(handles.map(handle => handle.getProperty('href')));
  const hrefs = await Promise.all(hrefHandles.map(handle => handle.jsonValue()));
  // Dispose of the handles to avoid memory leaks
  // [...hrefHandles, ...handles].forEach(handle => handle.dispose());
  // Deduplicate the array
  return Array.from(new Set(hrefs));
}

async function getProofLinks(page) {
  const handles = await page.$$('a');
  const hrefHandles = await Promise.all(handles.map(handle => handle.getProperty('href')));
  let hrefs = await Promise.all(hrefHandles.map(handle => handle.jsonValue()));
  const filterRegex = /\.(?!htm)[a-z0-9]{3,6}$/;
  hrefs = hrefs.filter(href => {
    return !!href.match(filterRegex);
  });
  return Array.from(new Set(hrefs));
}

async function downloadAll(links, siteUrl) {
  const pool = new PromisePool({ numConcurrent: DL_CONCURRENCY });
  for (link of links) {
    await pool.start(async (link) => {
      let dest;
      try {
        if (downloaded.has(link)) {
          return;
        }
        downloaded.add(link);
        dest = getFilePath(new URL(link, siteUrl), siteUrl);
        const exists = await alreadyExists(dest);
        if (exists) {
          return;
        }
        const dlPromise = download(link, dest)
          .then(() => console.log(link));
        // Add a delay so the server doesn't block us
        const delayPromise = delay(DL_THROTTLE);
        await Promise.all([dlPromise, delayPromise]);
      } catch (err) {
        console.error('[error]', link);
        console.error(err);
      } 
    }, link);
  }
  await pool.flush();
}

async function alreadyExists(filePath) {
  try {
    const result = await fse.stat(filePath);
    return result.size > 0;
  } catch (err) {
    if (err && err.code == 'ENOENT') {
      return false;
    }
    throw err;
  }
}

async function moveFile(src, dest) {
  try {
    await fse.ensureDir(path.dirname(dest));
    await fse.rename(src, dest);
  } catch (err) {
    await fse.move(src, dest);
  }
}

async function download(url, dest) {
  return new Promise(async (resolve, reject) => {
    const { fd, path: tmpPath, cleanup } = await file();
    try {
      const tmpFile = fse.createWriteStream(null, { fd });
      const urlObj = new URL(url);
      const agent = urlObj.protocol === 'https' ? https : http;
      agent.get(url, (response) => {
        response.pipe(tmpFile);
        tmpFile.once('error', handleError);
        tmpFile.once('finish', async () => {
          try {
            await tmpFile.close();
            await moveFile(tmpPath, dest);
            resolve();
          } catch (err) {
            handleError(err);
          }
        });
      }).once('error', handleError);
    } catch (err) {
      handleError(err);
    }
    
    async function handleError(err) {
      cleanup();
      reject(err);
    }
  });
}

async function delay(ms) {
  return new Promise(resolve => {
    setTimeout(() => resolve(), ms);
  });
}

function getDefaultSite() {
  return 'https://' + DEFAULT_SITE_CODED.split('').reverse().join('');
}
  
main();
