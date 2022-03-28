const { React } = require('powercord/webpack');
const { SwitchItem, TextInput } = require('powercord/components/settings');

module.exports = class Settings extends React.Component {
  render () {
    const { getSetting, updateSetting, toggleSetting } = this.props;

    return (
      <div>
        <SwitchItem
          note='Enable spotify lyrics to show up as your status'
          value={getSetting('enabled', false)}
          onChange={() => toggleSetting('enabled')}
        >
          Enable Lyrics
        </SwitchItem>
        <TextInput
          note={'The usertoken parameter extracted from the musixmatch desktop app'}
          defaultValue={getSetting('mxm-usertoken', 'put me')}
          required={true}
          onChange={val => updateSetting('mxm-usertoken', val)}
        >
          MXM User Token
        </TextInput>
        <TextInput
          note={'The signature parameter extracted from the musixmatch desktop app'}
          defaultValue={getSetting('mxm-signature', 'put me')}
          required={true}
          onChange={val => updateSetting('mxm-signature', val)}
        >
          MXM Signature
        </TextInput>
        <TextInput
          note={'The cookie parameter extracted from the musixmatch desktop app'}
          defaultValue={getSetting('mxm-cookie', 'put me')}
          required={true}
          onChange={val => updateSetting('mxm-cookie', val)}
        >
          MXM Cookie
        </TextInput>
      </div>
    );
  }
};
