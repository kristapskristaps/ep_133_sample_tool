# Updated as of 21st May, 2026

Thank you, [@garettejwilke](https://github.com/garrettjwilke), I'll take good care of it. 

Updated this to work with all the EP series! 

Note: A lot of the awesome features mentioned below were overwritten by the latest update. Consider 1.3.0 to be a basic update to give functionality to the whole EP series. For now, this is an exact replica of TE's online tool. 

---

# EP-133 Sample Tool - Offline Version

![sample tool](zoom_in.png)

## Compatability

EP-133 (64mb or 128mb), EP-1320, and EP-40. The gangs all here!

## Features

**100% fully offline.** This does not connect to the internet to fetch/cache. All of the web assembly is scraped and included. The original Factory Sound Pack is included in this (which is part of the reason why the executable is over 100MB). Of course, this version will be updated if the original tool is ever updated.

**Debug MIDI-Sysex Messages.** You can open the developer tools in this application and view the raw MIDI-Sysex messages sent to your EP-133. This can be very valuable when trying to reverse engineer how the EP-133 works. In fact, I have done this myself in an attempt to learn how the EP-133 works. I have successfully reverse engineered how the sample tool sends files back and forth. You can send entire sound packs directly to the EP-133 without this tool right now. I just haven't built a nice GUI for this, so for now all of these tools are command-line/terminal only. You can check out my reverse engineering work [here.](https://github.com/garrettjwilke/ep_133_sysex_thingy)

Click on `View > Toggle Developer Tools` to see raw MIDI-SYSEX messages:
![debug](debug.png)

---

## Troubleshooting

If you ever have issues with connectivity, refresh the application (click on `View > Reload`).

If you have trouble getting the application to start, you can try the [lo-tech method](./#how-to-run-without-electron).

---

## Download

On the right side of this page is the `Releases` section. You can find this app for Windows, Mac, and Linux.

Note: 1.3.0 releases arent built yet, for now you'll need to build them from scratch. 

---

## How to build from source

## Requirements

`npm`
`electron`
`electron-builder`

## How to build

after requirements are installed, simply run:
```
npm run package
```

all build files are in the `dist` directory.

## How to run without building

you do not need `electron-builder` to run. all you need is npm and electron installed.
```
npm start
```

## How to run without electron

### Requirements

`python3`

This guide is for MacOs or Linux. If you're on Windows and find a solution, please make a Pull Request with detailed instructions.

```sh
git clone https://github.com/pbarilla/ep_133_sample_tool.git
cd ep_133_sample_tool
```

If you have problems using `git`, you can also click on the green "code" button on the Github page and chose "Download ZIP" and extract its content and change into the project directory:


```sh
cd ep_133_sample_tool-main
```

```sh
cd data
python3 -m http.server
```

You'll need to keep this application running while using the EP-133/1320 Sample tool!

In your browser, visit: http://localhost:8000

When you're done with using the application, you can shutdown the server using <kbd>Ctrl</kbd> + <kbd>c</kbd>.
