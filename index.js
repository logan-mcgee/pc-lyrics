const { Plugin } = require('../../../fake_node_modules/powercord/entities');
const { getModule, constants, spotify, spotifySocket } = require('../../../fake_node_modules/powercord/webpack');
const { get } = require('../../../fake_node_modules/powercord/http');
const { inject, uninject } = require('../../../fake_node_modules/powercord/injector');
const Settings = require('./Settings');
const updateRemoteSettings = getModule([ 'updateRemoteSettings' ], false);

function printf (...args) {
  console.log('%c[Spotify-Lyrics]', 'color: #1DB954', ...args);
}

function showToast (...args) {
  powercord.api.notices.sendToast('lyric-status', {
    header: 'Spotify Lyrics',
    content: args.join(' '),
    icon: 'wrench',
    timeout: 5000
  });
}

const currentTrackData = {
  uri: null,
  startTime: null,
  curLyrTime: null
};
let lyricTicker = null;

const cachedLyrics = {};

module.exports = class SpotifyLyrics extends Plugin {
  async startPlugin () {
    powercord.api.settings.registerSettings('spotify-lyrics', {
      category: this.entityID,
      label: 'Spotify Lyrics',
      render: Settings
    });

    const spotifyToken = await this.getSpotifyToken();
    printf('[spotify-lyrics]', 'Fetched spotify token: ', spotifyToken);

    const { SpotifySocket } = await getModule([ 'SpotifySocket' ]);
    inject('spotify-lyrics-socket', SpotifySocket.prototype, 'handleMessage', ([ e ]) => this.handleSpotifyMessage(e));
    spotifySocket.getActiveSocketAndDevice()?.socket.socket.close();

    showToast('hooked spotify socket and grabbed token, waiting for events');
  }

  setStatus ({ text, emojiName, emojiId }) {
    updateRemoteSettings.updateRemoteSettings({
      customStatus: {
        text,
        emojiName,
        emojiId
      }
    });
  }

  async handleStateChange (data) {
    const { state } = data.event;
    const { progress_ms, is_playing, item: song_data } = state;

    if (!is_playing) {
      if (lyricTicker) {
        printf('paused');
        this.setStatus({ text: '' });
        clearInterval(lyricTicker);
        currentTrackData.uri = null;
      }
      return;
    }
    printf('playing');
    if (song_data.uri === currentTrackData.uri) {
      if (lyricTicker) {
        printf('time sync');
        currentTrackData.startTime = new Date(Date.now() - progress_ms);
        currentTrackData.curLyrTime = 0.0;
      }
      return;
    }

    if (lyricTicker) {
      clearInterval(lyricTicker);
      this.setStatus({ text: '' });
    }

    currentTrackData.uri = song_data.uri;
    currentTrackData.startTime = new Date(Date.now() - progress_ms);
    currentTrackData.curLyrTime = 0.0;

    printf(song_data.name, song_data.artists[0].name, song_data.artists.map(a => a.name).join(', '), song_data.album.name, song_data.duration_ms, song_data.uri);
    const lyrData = await this.performLyricSearch(song_data.name, song_data.artists[0].name, song_data.artists.map(a => a.name).join(', '), song_data.album.name, song_data.duration_ms, song_data.uri);

    lyricTicker = setInterval(() => {
      const newTime = ((Date.now() - currentTrackData.startTime) / 1000).toFixed(2);

      if (lyrData[newTime] && newTime !== currentTrackData.curLyrTime) {
        this.setStatus({
          text: lyrData[newTime]
        });
        currentTrackData.curLyrTime = newTime;
      }

      if (song_data.duration_ms / 1000 < newTime) {
        clearInterval(lyricTicker);
        printf('no song', newTime, song_data.duration_ms);
        currentTrackData.uri = null;
      }
    }, 0);
    printf(lyrData);
  }

  handleSpotifyMessage (msg) {
    if (!this.settings.get('enabled', false)) {
      if (lyricTicker) {
        clearInterval(lyricTicker);
        this.setStatus({ text: '' });
      }
      return;
    }

    const data = JSON.parse(msg.data);
    if (!data.type === 'message' || !data.payloads) {
      return;
    }

    for (const payload of data.payloads) {
      for (const events of payload.events) {
        if (events.type === 'PLAYER_STATE_CHANGED') {
          this.handleStateChange(events);
        }
      }
    }
  }

  async getSpotifyToken () {
    const spotifyMdl = await getModule([ 'getActiveSocketAndDevice' ]);
    const active = spotifyMdl.getActiveSocketAndDevice();
    if (active && active.socket && active.socket.accessToken) {
      return active.socket.accessToken;
    }
    return false;
  }

  async performLyricSearch (trackName, primaryArtist, artistNames, albumName, duration, songUri) {
    printf('q_track', trackName,
      'q_artist', primaryArtist,
      'q_artists', artistNames,
      'q_album', albumName,
      'user_language', 'en',
      'q_duration', duration / 1000,
      'tags', 'nowplaying',
      'namespace', 'lyrics_synched',
      'part', 'lyrics_crowd,user,lyrics_verified_by',
      'track_spotify_id', songUri,
      'f_subtitle_length_max_deviation', '1',
      'subtitle_format', 'mxm',
      'usertoken', this.settings.get('mxm-usertoken', 'put me'),
      'signature', this.settings.get('mxm-signature', 'put me'),
      'signature_protocol', 'sha1',
      'app_id', 'web-desktop-app-v1.0',
      'Cookie', this.settings.get('mxm-cookie', 'put me'));
    try {
      let json;
      // cache the previous lyrics, incase e.g a pause occurs, or the song is on loop
      if (cachedLyrics.uri !== songUri) {
        const request = await get('https://apic-desktop.musixmatch.com/ws/1.1/macro.subtitles.get')
          .query('format', 'json')
          .query('q_track', trackName)
          .query('q_artist', primaryArtist)
          .query('q_artists', artistNames)
          .query('q_album', albumName)
          .query('user_language', 'en')
          .query('q_duration', duration / 1000)
          .query('tags', 'nowplaying')
          .query('namespace', 'lyrics_synched')
          .query('part', 'lyrics_crowd,user,lyrics_verified_by')
          .query('track_spotify_id', songUri)
          .query('f_subtitle_length_max_deviation', '1')
          .query('subtitle_format', 'mxm')
          .query('usertoken', this.settings.get('mxm-usertoken', 'put me'))
          .query('signature', this.settings.get('mxm-signature', 'put me'))
          .query('signature_protocol', 'sha1')
          .query('app_id', 'web-desktop-app-v1.0')
          .set('Cookie', this.settings.get('mxm-cookie', 'put me'))
          .set('Content-Type', 'application/json')
          .execute();

        if (request.statusCode !== 200) {
          printf('failed to search lyrics. could be captcha\'d, or theres no lyrics.');
          showToast('failed to search lyrics. could be captcha\'d, or theres no lyrics.');
          return false;
        }
        json = JSON.parse(new TextDecoder('utf-8').decode(request.body));

        cachedLyrics.uri = songUri;
        cachedLyrics.data = json;
      } else {
        json = cachedLyrics.data;
      }


      // extract the lyrics into a sorted object

      const MXM_MacroCalls = json.message.body.macro_calls;

      const userLyricsFound = MXM_MacroCalls['userblob.get'].message.header.status_code === 200;
      const lyricsFound = MXM_MacroCalls['track.subtitles.get'].message.header.status_code === 200;

      if (!userLyricsFound && !lyricsFound) {
        printf(`macrocalls err. userblob.get/subtitles.get were invalid: status - ${MXM_MacroCalls['userblob.get'].message.header.status_code} - ${MXM_MacroCalls['track.subtitles.get'].message.header.status_code}`);
        showToast(`macrocalls err. userblob.get/subtitles.get were invalid: status - ${MXM_MacroCalls['userblob.get'].message.header.status_code} - ${MXM_MacroCalls['track.subtitles.get'].message.header.status_code}`);
        return false;
      }

      const lyricData = userLyricsFound ? MXM_MacroCalls['userblob.get'].message.body.subtitles : JSON.parse(MXM_MacroCalls['track.subtitles.get'].message.body.subtitle_list[0].subtitle.subtitle_body);
      const sortedLyrics = {};
      for (const lyric of lyricData) {
        sortedLyrics[lyric.time.total.toFixed(2)] = lyric.text;
      }

      return sortedLyrics;
    } catch (e) {
      printf('err occured', e);
      return false;
    }
  }


  async pluginWillUnload () {
    powercord.api.settings.unregisterSettings('spotify-lyrics');
    uninject('spotify-lyrics-socket');
  }
};
