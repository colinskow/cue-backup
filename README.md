# Cue Backup 🐸

`cue-backup` helps you download a safe offline copy of your favorite insider drop aggregator website. It has all the functionality of the original site, but works even when you are offline (or if the original disappears).

## Installation

1) Download and install the [LTS version of Node.js](https://nodejs.org) for your operating system.

2) Download and unzip this repository onto your computer. Use the green "Code" button above. (Or use `git clone` if you are familiar.)

3) Open up a command prompt or terminal in the `cue-backup` folder you just unzipped. ([Tutorial here](https://www.groovypost.com/howto/open-command-window-terminal-window-specific-folder-windows-mac-linux/) if you don't know how.)

4) Type `npm install` into the command prompt to install the required dependencies.

## Usage

1) Type `node backup` into the command prompt to download the site. This may take a while depending on your internet connection. If you see any errors, run the command again until it completes successfully. (You can also specify an alternate URL `node backup https://anothersite.pub`.)

2) Whenever new posts appear you can run the backup command again and it will incrementally download anything new.

3) Once your backup is complete you can type `npm start` into the command prompt to launch the local version of the site. This should automatically open the site a web browser for you.

4) Press `CTRL-C` inside the terminal window to stop the web server.

## Under the Hood

`cue-backup` uses a headless (no screen display) version of the Chrome Browser powered by [Puppeteer](https://developers.google.com/web/tools/puppeteer) to load the website, download all the assets and produce a version which works entirely offline. Requests are throttled to avoid straining the server. You can adjust the throttle settings at the top of `backup.js`.

It should work on Mac, Linux and Windows.
