'use strict';
'require view';
'require dom';
'require poll';
'require rpc';
'require uci';
'require ui';

var callBoard = rpc.declare({
	object: 'system',
	method: 'board',
	expect: { '': {} }
});

var callLanStatus = rpc.declare({
	object: 'network.interface.lan',
	method: 'status',
	expect: { '': {} }
});

var callWirelessStatus = rpc.declare({
	object: 'network.wireless',
	method: 'status',
	expect: { '': {} }
});

var callFrequencyList = rpc.declare({
	object: 'iwinfo',
	method: 'freqlist',
	params: [ 'device' ],
	expect: { results: [] }
});

var callSetPassword = rpc.declare({
	object: 'luci',
	method: 'setPassword',
	params: [ 'username', 'password' ],
	expect: { result: false }
});

var WATCHCAT_SID = 'alemprator_periodic_reboot';
var STEP_KEYS = [ 'lan', 'mode', 'wifi', 'vlan', 'channel' ];

function notify(message) {
	ui.addNotification(null, E('p', message));
}

function isIPv4(value) {
	return /^(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])){3}$/.test(value || '');
}

function strip5GSuffix(value) {
	return String(value || '').replace(/[ _-]?5g(?:hz)?$/i, '');
}

function normalizeMode(value) {
	if (value == 'ap' || value == 'ap_wds' || value == 'sta_wds' || value == 'mesh')
		return value;

	return 'ap';
}

function modeNeedsDeferredApply(value) {
	return false;
}

function deriveVlanGateway(baseIp, vlanId) {
	var octets = String(baseIp || '').split('.');
	var derivedId = Math.min(Math.max(parseInt(vlanId, 10) || 10, 1), 254);

	if (octets.length == 4)
		return [ octets[0], octets[1], String(derivedId), '1' ].join('.');

	return [ '192', '168', String(derivedId), '1' ].join('.');
}

function describeSecondaryVlanBinding(vlanId) {
	var normalizedId = Math.min(Math.max(parseInt(vlanId, 10) || 10, 1), 4094);

	return 'wizardvlan -> vlan_' + normalizedId + ' (' + _('Unmanaged') + ')';
}

function normalizeList(value) {
	if (Array.isArray(value))
		return value.slice();

	if (value == null || value === '')
		return [];

	return [ value ];
}

function ensureListContains(conf, sid, opt, value) {
	var list = normalizeList(uci.get(conf, sid, opt));

	if (list.indexOf(value) == -1) {
		list.push(value);
		uci.set(conf, sid, opt, list);
	}
}

function removeListValue(conf, sid, opt, value) {
	var list = normalizeList(uci.get(conf, sid, opt)).filter(function(entry) {
		return entry != value;
	});

	if (list.length)
		uci.set(conf, sid, opt, list);
	else
		uci.unset(conf, sid, opt);
}

function findFirewallZone(name) {
	var zones = uci.sections('firewall', 'zone');
	var i;

	for (i = 0; i < zones.length; i++) {
		if (zones[i].name == name)
			return zones[i]['.name'];
	}

	return null;
}

function findWifiIface(deviceName) {
	var sections = uci.sections('wireless', 'wifi-iface');
	var fallback = null;
	var i;

	for (i = 0; i < sections.length; i++) {
		var section = sections[i];

		if (section.device != deviceName)
			continue;

		if (fallback == null)
			fallback = section['.name'];

		if (section.mode == null || section.mode == 'ap')
			return section['.name'];
	}

	return fallback;
}

function ensureWifiIface(deviceName) {
	var ifaceName = findWifiIface(deviceName);

	if (ifaceName != null)
		return ifaceName;

	ifaceName = uci.add('wireless', 'wifi-iface');
	uci.set('wireless', ifaceName, 'device', deviceName);
	uci.set('wireless', ifaceName, 'mode', 'ap');
	uci.set('wireless', ifaceName, 'network', 'lan');
	uci.set('wireless', ifaceName, 'encryption', 'none');
	uci.set('wireless', ifaceName, 'ssid', 'OpenWrt');

	return ifaceName;
}

function secondaryApSectionName(deviceName) {
	return 'wizard_vlan_' + String(deviceName || 'radio').replace(/[^A-Za-z0-9_]/g, '_') + '_ap';
}

function secondarySsid(baseSsid, band) {
	var normalizedBase = String(baseSsid || 'OpenWrt').trim() || 'OpenWrt';

	if (band == '5g')
		return normalizedBase + '_VLAN_5G';

	return normalizedBase + '_VLAN';
}

function primarySsid(baseSsid, band) {
	var state = (baseSsid != null && typeof baseSsid == 'object') ? baseSsid : null;
	var normalizedBase = String(state ? state.wifiSsid : baseSsid || 'OpenWrt').trim() || 'OpenWrt';
	var custom5g = String(state ? state.wifiSsid5g : '').trim();
	var custom5gEnabled = !!(state && state.wifiSsid5gMode == 'custom' && custom5g);

	if (band == '5g')
		if (custom5gEnabled)
			return custom5g;

	if (band == '5g')
		return normalizedBase + '_5G';

	return normalizedBase;
}

function applyWifiIfaceFlag(conf, sid, optionName, enabled) {
	if (enabled == null)
		return;

	if (enabled)
		uci.set(conf, sid, optionName, '1');
	else
		uci.unset(conf, sid, optionName);
}

function getLocalApPolicy(state, networkName) {
	return {
		network: networkName || 'lan',
		enableWds: (normalizeMode(state.mode) == 'ap_wds'),
		hidden: null,
		isolate: null
	};
}

function sortBands(bands) {
	var order = {
		'2g': 0,
		'5g': 1
	};

	return (bands || []).slice().sort(function(a, b) {
		return (order[a] != null ? order[a] : 99) - (order[b] != null ? order[b] : 99);
	});
}

function getRemainingLocalBands(radios, state) {
	var requestedMode = normalizeMode(state.mode);
	var blockedRadioName = null;
	var bands = [];
	var selectedRadio;

	if (requestedMode == 'sta_wds') {
		selectedRadio = getRadioByBand(radios, state.uplinkBand);

		if (selectedRadio == null)
			selectedRadio = getRadioByBand(radios, '2g') || getRadioByBand(radios, '5g');

		blockedRadioName = selectedRadio ? selectedRadio['.name'] : null;
	}
	else if (requestedMode == 'mesh') {
		selectedRadio = getRadioByBand(radios, state.meshBand);

		if (selectedRadio == null)
			selectedRadio = getRadioByBand(radios, '2g') || getRadioByBand(radios, '5g');

		blockedRadioName = selectedRadio ? selectedRadio['.name'] : null;
	}

	(radios || []).forEach(function(radio) {
		if (blockedRadioName && radio['.name'] == blockedRadioName)
			return;

		if (radio.band == '2g' || radio.band == '5g')
			bands.push(radio.band);
	});

	return sortBands(bands);
}

function describeAppliedSecondaryNetworkResult(state, radios) {
	var remainingBands = getRemainingLocalBands(radios, state);
	var remainingCount = remainingBands.length;
	var onlyBand = remainingCount ? remainingBands[0] : null;

	if (!state.isVlan)
		return null;

	if (!remainingCount)
		return _('The secondary unmanaged VLAN bridge configuration was saved, but no radio remains available for a local AP in the selected mode, so no secondary Wi-Fi SSID was created. Primary LAN and backhaul stay on LAN.');

	if (state.mode == 'ap_wds') {
		if (remainingCount == 1)
			return _('The secondary unmanaged VLAN bridge is active. Primary Wi-Fi stays on LAN, and the VLAN-backed secondary SSID is now served on the local AP on ') + bandLabel(onlyBand) + _(' with WDS enabled.');

		return _('The secondary unmanaged VLAN bridge is active. Primary Wi-Fi stays on LAN, and the VLAN-backed secondary SSIDs are now served on both local AP radios with WDS enabled.');
	}

	if (remainingCount == 1)
		return _('The secondary unmanaged VLAN bridge is active. Primary Wi-Fi stays on LAN, and only the remaining local AP on ') + bandLabel(onlyBand) + _(' is serving the VLAN-backed secondary SSID.');

	return _('The secondary unmanaged VLAN bridge is active. Primary Wi-Fi stays on LAN, and the VLAN-backed secondary SSIDs are now served on the remaining local AP radios.');
}

function describeAppliedModeResult(state, radios) {
	var remainingBands = getRemainingLocalBands(radios, state);
	var onlyBand = remainingBands[0];
	var radio2g = getRadioByBand(radios || [], '2g');
	var uplinkBand = getRadioByBand(radios || [], state.uplinkBand) ? state.uplinkBand : (radio2g ? '2g' : '5g');
	var meshBand = getRadioByBand(radios || [], state.meshBand) ? state.meshBand : (radio2g ? '2g' : '5g');

	if (state.mode == 'ap_wds') {
		if (!remainingBands.length)
			return _('Access Point + WDS mode was saved, but no local AP radio is currently available for Wi-Fi service.');

		if (remainingBands.length == 1)
			return _('Access Point + WDS mode has been applied on the local AP on ') + bandLabel(onlyBand) + _('.');

		return _('Access Point + WDS mode has been applied on both local AP radios.');
	}

	if (state.mode == 'sta_wds') {
		if (!remainingBands.length)
			return _('Client + WDS is using ') + bandLabel(uplinkBand) + _(' for the uplink, so no local AP remains active on Wi-Fi. LAN access remains available.');

		if (remainingBands.length == 1)
			return _('Client + WDS mode has been applied on ') + bandLabel(uplinkBand) + _(' for the uplink, while the local AP on ') + bandLabel(onlyBand) + _(' remains active.');

		return _('Client + WDS mode has been applied on ') + bandLabel(uplinkBand) + _(' for the uplink, while the remaining local AP radios stay active.');
	}

	if (state.mode == 'mesh') {
		if (!remainingBands.length)
			return _('Mesh is using ') + bandLabel(meshBand) + _(' as the backhaul radio, so no local AP remains active on Wi-Fi. LAN access remains available.');

		if (remainingBands.length == 1)
			return _('Mesh mode has been applied on ') + bandLabel(meshBand) + _(' as the backhaul radio, while the local AP on ') + bandLabel(onlyBand) + _(' remains active.');

		return _('Mesh mode has been applied on ') + bandLabel(meshBand) + _(' as the backhaul radio, while the remaining local AP radios stay active.');
	}

	if (modeNeedsDeferredApply(state.mode))
		return _('The selected operating mode was saved, but its specialized network behavior will be added in a later stage. Wireless remains on Access Point behavior for now.');

	return null;
}

function describeReconnectHint(state, radios, oldBaseSsid) {
	var remainingBands = getRemainingLocalBands(radios, state);
	var newBaseSsid = String(state.wifiSsid || '').trim();
	var oldNormalizedBaseSsid = String(oldBaseSsid || '').trim();
	var activeSsids;

	if (!newBaseSsid || newBaseSsid == oldNormalizedBaseSsid || !remainingBands.length)
		return null;

	activeSsids = remainingBands.map(function(band) {
		return primarySsid(state, band);
	});

	if (activeSsids.length == 1)
		return _('Reconnect manually to the active local SSID: ') + activeSsids[0] + _('.');

	return _('Reconnect manually to one of the active local SSIDs: ') + activeSsids.join(', ') + _('.');
}

function describePrimaryWifiPlan(state, radios) {
	var remainingBands = getRemainingLocalBands(radios, state);
	var firstBand = remainingBands[0];
	var secondBand = remainingBands[1];

	if (!remainingBands.length)
		return _('In the selected mode, no local primary Wi-Fi SSID will remain active. LAN access stays available.');

	if (remainingBands.length == 1)
		return _('The active local primary SSID will be ') + primarySsid(state, firstBand) + _(' on ') + bandLabel(firstBand) + _('.');

	return _('The local primary SSIDs will be ') + primarySsid(state, firstBand) + _(' on ') + bandLabel(firstBand) + _(' and ') + primarySsid(state, secondBand) + _(' on ') + bandLabel(secondBand) + _('.');
}

function describePrimaryWifiNamingHelp(state, radios) {
	var remainingBands = getRemainingLocalBands(radios, state);

	if (!remainingBands.length)
		return _('In this mode, no local primary Wi-Fi SSID remains active. The base name is still saved, and LAN access stays available.');

	if (remainingBands.length == 1) {
		if (remainingBands[0] == '5g')
			return _('In this mode, only the 5GHz radio remains available for the local AP, so the active local primary SSID uses the generated 5GHz name.');

		return _('In this mode, only the 2.4GHz radio remains available for the local AP, so the active local primary SSID uses the base name.');
	}

	return _('The 2.4GHz radio uses the base name, and the 5GHz name is generated automatically.');
}

function describeSecondaryNetworkNotice(state, radios) {
	var remainingBands = getRemainingLocalBands(radios, state);
	var onlyBand = remainingBands[0];
	var baseSsid = String(state.wifiSsid || '').trim() || 'OpenWrt';
	var firstBand = remainingBands[0];
	var secondBand = remainingBands[1];

	if (!state.isVlan)
		return '';

	if (!remainingBands.length)
		return _('In this mode, no local AP radio remains available for an extra secondary SSID. The unmanaged secondary VLAN bridge can still be configured, but no secondary Wi-Fi SSID will be broadcast unless a local AP radio remains available.');

	if (remainingBands.length == 1) {
		if (state.mode == 'ap_wds')
			return _('Only the remaining local AP on ') + bandLabel(onlyBand) + _(' can host the secondary VLAN-backed SSID ') + secondarySsid(baseSsid, onlyBand) + _(' on the unmanaged wizardvlan bridge in this mode, and that secondary local AP interface will also keep WDS enabled.');

		return _('Only the remaining local AP on ') + bandLabel(onlyBand) + _(' can host the secondary VLAN-backed SSID ') + secondarySsid(baseSsid, onlyBand) + _(' on the unmanaged wizardvlan bridge in this mode. Radios reserved for uplink or Mesh backhaul stay unchanged.');
	}

	if (state.mode == 'ap_wds')
		return _('Both remaining local AP radios can host the secondary VLAN-backed SSIDs ') + secondarySsid(baseSsid, firstBand) + _(' on ') + bandLabel(firstBand) + _(' and ') + secondarySsid(baseSsid, secondBand) + _(' on ') + bandLabel(secondBand) + _(' on the unmanaged wizardvlan bridge in this mode, and those secondary local AP interfaces will also keep WDS enabled.');

	return _('The remaining local AP radios can host the secondary VLAN-backed SSIDs ') + secondarySsid(baseSsid, firstBand) + _(' on ') + bandLabel(firstBand) + _(' and ') + secondarySsid(baseSsid, secondBand) + _(' on ') + bandLabel(secondBand) + _(' on the unmanaged wizardvlan bridge in this mode while primary LAN service and any uplink or Mesh backhaul stay unchanged.');
}

function describeSecondarySubnetHelp(state, radios) {
	var remainingBands = getRemainingLocalBands(radios, state);
	var onlyBand = remainingBands[0];
	var baseSsid = String(state.wifiSsid || '').trim() || 'OpenWrt';
	var firstBand = remainingBands[0];
	var secondBand = remainingBands[1];

	if (!state.isVlan)
		return _('When enabled, the secondary SSIDs will attach to this unmanaged VLAN bridge while the main LAN remains unchanged on the primary SSIDs.');

	if (!remainingBands.length)
		return _('This unmanaged VLAN bridge will be prepared for the secondary VLAN configuration, but no secondary Wi-Fi SSID can use it unless a local AP radio remains available in the selected mode.');

	if (remainingBands.length == 1)
		return _('Clients joining the secondary SSID ') + secondarySsid(baseSsid, onlyBand) + _(' on ') + bandLabel(onlyBand) + _(' will attach to this unmanaged VLAN bridge while the main LAN remains unchanged on the primary SSIDs.');

	return _('Clients joining the secondary SSIDs ') + secondarySsid(baseSsid, firstBand) + _(' on ') + bandLabel(firstBand) + _(' and ') + secondarySsid(baseSsid, secondBand) + _(' on ') + bandLabel(secondBand) + _(' will attach to this unmanaged VLAN bridge while the main LAN remains unchanged on the primary SSIDs.');
}

function describeSecondaryNetworkIntro(state, radios) {
	var remainingBands = getRemainingLocalBands(radios, state);
	var onlyBand = remainingBands[0];
	var baseSsid = String(state.wifiSsid || '').trim() || 'OpenWrt';
	var firstBand = remainingBands[0];
	var secondBand = remainingBands[1];

	if (!remainingBands.length)
		return _('Your primary LAN and any mode-specific backhaul remain on LAN. In the selected mode, this step can prepare an extra unmanaged VLAN bridge, but no secondary Wi-Fi SSID can be broadcast because no local AP radio remains available.');

	if (remainingBands.length == 1)
		return _('Your primary LAN and any mode-specific backhaul remain on LAN. In the selected mode, this step adds an extra unmanaged VLAN-backed Wi-Fi attachment using the secondary SSID ') + secondarySsid(baseSsid, onlyBand) + _(' on the remaining local AP on ') + bandLabel(onlyBand) + _('.');

	return _('Your primary LAN and any mode-specific backhaul remain on LAN. This step adds an extra unmanaged VLAN-backed Wi-Fi attachment using the secondary SSIDs ') + secondarySsid(baseSsid, firstBand) + _(' on ') + bandLabel(firstBand) + _(' and ') + secondarySsid(baseSsid, secondBand) + _(' on ') + bandLabel(secondBand) + _(' without moving the main Wi-Fi away from LAN.');
}

function describeUplinkSettingsHelp(state, radios) {
	var radio2g = getRadioByBand(radios || [], '2g');
	var uplinkBand = getRadioByBand(radios || [], state.uplinkBand) ? state.uplinkBand : (radio2g ? '2g' : '5g');
	var remainingBands = getRemainingLocalBands(radios || [], state);
	var onlyBand = remainingBands[0];

	if (!remainingBands.length)
		return _('These values control the real uplink used by Client + WDS mode. The selected radio on ') + bandLabel(uplinkBand) + _(' becomes the client bridge uplink, and no local AP radio remains active on Wi-Fi in this configuration.');

	if (remainingBands.length == 1)
		return _('These values control the real uplink used by Client + WDS mode. The selected radio on ') + bandLabel(uplinkBand) + _(' becomes the client bridge uplink, and the remaining local AP on ') + bandLabel(onlyBand) + _(' stays available for the local Wi-Fi network.');

	return _('These values control the real uplink used by Client + WDS mode. The selected radio becomes the client bridge uplink, while any remaining radio stays available for the local AP.');
}

function describeMeshSettingsHelp(state, radios) {
	var radio2g = getRadioByBand(radios || [], '2g');
	var meshBand = getRadioByBand(radios || [], state.meshBand) ? state.meshBand : (radio2g ? '2g' : '5g');
	var remainingBands = getRemainingLocalBands(radios || [], state);
	var onlyBand = remainingBands[0];

	if (!remainingBands.length)
		return _('The selected Mesh radio on ') + bandLabel(meshBand) + _(' joins or creates the Mesh, and no local AP radio remains active on Wi-Fi in this configuration.');

	if (remainingBands.length == 1)
		return _('The selected Mesh radio on ') + bandLabel(meshBand) + _(' joins or creates the Mesh, while the remaining local AP on ') + bandLabel(onlyBand) + _(' stays available for the local Wi-Fi network.');

	return _('The selected Mesh radio joins or creates a Mesh on the chosen band, while any remaining radio stays available for the local AP.');
}

function describeMeshChannelHelp(state, radios) {
	var radio2g = getRadioByBand(radios || [], '2g');
	var meshBand = getRadioByBand(radios || [], state.meshBand) ? state.meshBand : (radio2g ? '2g' : '5g');
	var meshChannel = meshBand == '5g' ? state.channel5g : state.channel2g;

	if (meshChannel && meshChannel != 'auto')
		return _('Mesh will use the fixed ') + bandLabel(meshBand) + _(' channel ') + meshChannel + _('.');

	return _('Mesh requires a fixed channel on ') + bandLabel(meshBand) + _('. Auto cannot be used for the Mesh band.');
}

function configureApIface(sid, deviceName, networkName, ssid, key, enableWds) {
	var policy = (enableWds != null && typeof enableWds == 'object') ? enableWds : {
		enableWds: !!enableWds,
		hidden: null,
		isolate: null
	};

	uci.set('wireless', sid, 'device', deviceName);
	uci.set('wireless', sid, 'mode', 'ap');
	uci.set('wireless', sid, 'network', networkName);
	uci.set('wireless', sid, 'disabled', '0');
	uci.set('wireless', sid, 'ssid', ssid);
	uci.unset('wireless', sid, 'mesh_id');
	setWifiSecurity('wireless', sid, key);

	if (policy.enableWds)
		uci.set('wireless', sid, 'wds', '1');
	else
		uci.unset('wireless', sid, 'wds');

	applyWifiIfaceFlag('wireless', sid, 'hidden', policy.hidden);
	applyWifiIfaceFlag('wireless', sid, 'isolate', policy.isolate);
}

function wifiDeviceName(device) {
	return device ? device['.name'] : null;
}

function inferUplinkBand(radio2g, radio5g) {
	var configuredBand = uci.get('setup', 'default', 'uplink_band');
	var uplinkDevice = uci.get('wireless', 'wizard_uplink', 'device');

	if (radio2g && uplinkDevice == radio2g['.name'])
		return '2g';

	if (radio5g && uplinkDevice == radio5g['.name'])
		return '5g';

	if (configuredBand == '2g' || configuredBand == '5g')
		return configuredBand;

	return radio2g ? '2g' : '5g';
}

function inferMeshBand(radio2g, radio5g) {
	var configuredBand = uci.get('setup', 'default', 'mesh_band');
	var meshDevice = uci.get('wireless', 'wizard_mesh', 'device');

	if (radio2g && meshDevice == radio2g['.name'])
		return '2g';

	if (radio5g && meshDevice == radio5g['.name'])
		return '5g';

	if (configuredBand == '2g' || configuredBand == '5g')
		return configuredBand;

	return radio2g ? '2g' : '5g';
}

function ensureNamedWifiIface(sid) {
	ensureNamedSection('wireless', sid, 'wifi-iface');
	return sid;
}

function setWifiSecurity(conf, sid, key) {
	if (key) {
		uci.set(conf, sid, 'encryption', 'psk2');
		uci.set(conf, sid, 'key', key);
	}
	else {
		uci.set(conf, sid, 'encryption', 'none');
		uci.unset(conf, sid, 'key');
	}
}

function ensureNamedSection(conf, sid, type) {
	if (!uci.get(conf, sid))
		uci.add(conf, type, sid);
}

function getPeriodicRebootSection() {
	var section = uci.get('watchcat', WATCHCAT_SID);

	if (section && section['.type'] == 'watchcat')
		return section;

	return null;
}

function parseHours(value) {
	var normalized = String(value || '').trim().toLowerCase();
	var amount;

	if (!normalized)
		return null;

	if (/^[1-9][0-9]*$/.test(normalized))
		return normalized;

	if ((amount = normalized.match(/^([1-9][0-9]*)h$/)))
		return amount[1];

	if ((amount = normalized.match(/^([1-9][0-9]*)d$/)))
		return String(parseInt(amount[1], 10) * 24);

	if ((amount = normalized.match(/^([1-9][0-9]*)m$/)))
		return String(Math.max(Math.round(parseInt(amount[1], 10) / 60), 1));

	if ((amount = normalized.match(/^([1-9][0-9]*)s$/)))
		return String(Math.max(Math.round(parseInt(amount[1], 10) / 3600), 1));

	return null;
}

function formatRebootPeriod(hours) {
	return String(parseInt(hours, 10)) + 'h';
}

function radioLabel(device) {
	var label = _('Radio') + ' ' + device['.name'];

	if (device.band)
		label += ' (' + String(device.band).toUpperCase() + ')';

	return label;
}

function bandLabel(band) {
	if (band == '5g')
		return _('5GHz radio');

	return _('2.4GHz radio');
}

function getRadioByBand(radios, band) {
	var i;

	for (i = 0; i < radios.length; i++) {
		if (radios[i].band == band)
			return radios[i];
	}

	if (band == '2g')
		return radios[0] || null;

	if (band == '5g')
		return radios[1] || radios[0] || null;

	return null;
}

function channelChoices(band, freqlist) {
	var choices = [ { value: 'auto', label: _('Auto') } ];
	var seen = { auto: true };
	var fallback;

	if (Array.isArray(freqlist) && freqlist.length) {
		freqlist.forEach(function(freq) {
			var restricted = !!freq.restricted && (freq.no_ir || (Array.isArray(freq.flags) && freq.flags.indexOf('no_ir') > -1));
			var channel = String(freq.channel || '');

			if (!channel || restricted || seen[channel])
				return;

			seen[channel] = true;
			choices.push({
				value: channel,
				label: channel + ' (' + String(freq.mhz || '?') + ' MHz)'
			});
		});
	}

	if (choices.length > 1)
		return choices;

	fallback = (band == '2g')
		? [ '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13' ]
		: [ '36', '40', '44', '48', '52', '56', '60', '64', '100', '104', '108', '112', '116', '120', '124', '128', '132', '136', '140', '144', '149', '153', '157', '161', '165' ];

	fallback.forEach(function(channel) {
		choices.push({ value: channel, label: channel });
	});

	return choices;
}

function populateSelectOptions(select, choices, currentValue) {
	var hasCurrentValue = false;

	select.textContent = '';

	choices.forEach(function(choice) {
		if (String(choice.value) == String(currentValue))
			hasCurrentValue = true;

		select.appendChild(E('option', { 'value': choice.value }, choice.label));
	});

	if (!hasCurrentValue && currentValue)
		select.appendChild(E('option', { 'value': currentValue }, String(currentValue)));

	select.value = currentValue || 'auto';
}

function renderWirelessSummary(status) {
	var entries = [];
	var keys = Object.keys(status || {}).sort();
	var i;

	if (!keys.length)
		return E('p', _('No wireless runtime information is currently available.'));

	for (i = 0; i < keys.length; i++) {
		var radioName = keys[i];
		var radio = status[radioName] || {};
		var ifaceSummary = [];
		var interfaces = Array.isArray(radio.interfaces) ? radio.interfaces : [];
		var j;

		for (j = 0; j < interfaces.length; j++) {
			var iface = interfaces[j] || {};
			var ssid = iface.ssid || (iface.config && iface.config.ssid) || '?';
			var mode = iface.mode || (iface.config && iface.config.mode) || '?';
			var state = iface.up ? _('up') : _('down');

			ifaceSummary.push(ssid + ' [' + mode + ', ' + state + ']');
		}

		if (!ifaceSummary.length)
			ifaceSummary.push(radio.up ? _('up') : _('down'));

		entries.push(E('li', radioLabel({ '.name': radioName, band: radio.config && radio.config.band }) + ': ' + ifaceSummary.join(', ')));
	}

	return E('ul', { 'style': 'margin:0; padding-left:1.2em' }, entries);
}

function renderStatusPanel(board, lanStatus, wirelessStatus) {
	var ipv4 = '-';
	var addresses = lanStatus && lanStatus['ipv4-address'];

	if (Array.isArray(addresses) && addresses.length) {
		ipv4 = addresses[0].address || '-';

		if (addresses[0].mask != null)
			ipv4 += '/' + addresses[0].mask;
	}

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', _('Runtime Status')),
		E('div', { 'class': 'cbi-section-node' }, [
			E('p', [
				E('strong', _('Model') + ': '),
				(board && board.model) || (board && board.system) || '-'
			]),
			E('p', [
				E('strong', _('Target') + ': '),
				(board && board.release && board.release.target) || '-'
			]),
			E('p', [
				E('strong', _('LAN address') + ': '),
				ipv4
			]),
			E('div', [
				E('strong', _('Wireless') + ': '),
				renderWirelessSummary(wirelessStatus)
			])
		])
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callBoard(), {}),
			L.resolveDefault(callLanStatus(), {}),
			L.resolveDefault(callWirelessStatus(), {}),
			uci.load('setup'),
			L.resolveDefault(uci.load('watchcat'), null),
			uci.load('network'),
			uci.load('wireless'),
			uci.load('dhcp'),
			uci.load('firewall')
		]).then(function(results) {
			var radios = uci.sections('wireless', 'wifi-device');

			return Promise.all(radios.map(function(radio) {
				return L.resolveDefault(callFrequencyList(radio['.name']), []);
			})).then(function(freqLists) {
				var frequencyMap = {};

				radios.forEach(function(radio, index) {
					frequencyMap[radio['.name']] = freqLists[index] || [];
				});

				results.push(frequencyMap);
				return results;
			});
		});
	},

	renderStatus: function(container) {
		return Promise.all([
			L.resolveDefault(callBoard(), {}),
			L.resolveDefault(callLanStatus(), {}),
			L.resolveDefault(callWirelessStatus(), {})
		]).then(function(results) {
			dom.content(container, renderStatusPanel(results[0], results[1], results[2]));
		});
	},

	readState: function(radios) {
		var radio2g = getRadioByBand(radios, '2g');
		var radio5g = getRadioByBand(radios, '5g');
		var iface2g = radio2g ? findWifiIface(radio2g['.name']) : null;
		var mode = normalizeMode(uci.get('setup', 'default', 'mode'));
		var baseSsid = uci.get('setup', 'default', 'wifi_ssid') || '';
		var key = uci.get('setup', 'default', 'wifi_key') || '';
		var rebootSection = getPeriodicRebootSection();
		var rebootHours = rebootSection ? parseHours(rebootSection.period) : null;

		if (!baseSsid && iface2g)
			baseSsid = strip5GSuffix(uci.get('wireless', iface2g, 'ssid') || '');

		if (!baseSsid)
			baseSsid = 'OpenWrt';

		if (!key && iface2g)
			key = uci.get('wireless', iface2g, 'key') || '';

		return {
			lanIpaddr: uci.get('network', 'lan', 'ipaddr') || uci.get('setup', 'default', 'lan_ipaddr') || '192.168.1.1',
			lanNetmask: uci.get('network', 'lan', 'netmask') || uci.get('setup', 'default', 'lan_netmask') || '255.255.255.0',
			mode: mode,
			wifiSsid: baseSsid,
			wifiSsid5gMode: uci.get('setup', 'default', 'wifi_ssid_5g_mode') == 'custom' ? 'custom' : 'derived',
			wifiSsid5g: uci.get('setup', 'default', 'wifi_ssid_5g') || '',
			wifiKey: key,
			uplinkSsid: uci.get('setup', 'default', 'uplink_ssid') || '',
			uplinkKey: uci.get('setup', 'default', 'uplink_key') || '',
			uplinkBand: inferUplinkBand(radio2g, radio5g),
			meshId: uci.get('setup', 'default', 'mesh_id') || '',
			meshKey: uci.get('setup', 'default', 'mesh_key') || '',
			meshBand: inferMeshBand(radio2g, radio5g),
			isVlan: uci.get('setup', 'default', 'is_vlan') == '1',
			vlanId: uci.get('setup', 'default', 'vlan_id') || '10',
			channel2g: (radio2g && uci.get('wireless', radio2g['.name'], 'channel')) || uci.get('setup', 'default', 'channel_2g') || 'auto',
			channel5g: (radio5g && uci.get('wireless', radio5g['.name'], 'channel')) || uci.get('setup', 'default', 'channel_5g') || 'auto',
			resetDisabled: uci.get('setup', 'default', 'reset_button_disabled') == '1',
			resetHoldSeconds: uci.get('setup', 'default', 'reset_hold_seconds') || '5',
			wpsDisabled: uci.get('setup', 'default', 'wps_button_disabled') == '1',
			rebootEnabled: rebootSection ? rebootSection.mode == 'periodic_reboot' : false,
			rebootHours: rebootHours || '24',
			adminPassword: '',
			adminPasswordConfirm: ''
		};
	},

	collectState: function() {
		this.state.lanIpaddr = this.refs.lanIpaddr.value.trim();
		this.state.lanNetmask = this.refs.lanNetmask.value.trim();
		this.state.mode = this.refs.mode.value;
		this.state.wifiSsid = this.refs.wifiSsid.value.trim();
		this.state.wifiSsid5gMode = this.refs.wifiSsid5gMode ? this.refs.wifiSsid5gMode.value : (this.state.wifiSsid5gMode || 'derived');
		this.state.wifiSsid5g = this.refs.wifiSsid5g ? this.refs.wifiSsid5g.value.trim() : (this.state.wifiSsid5g || '');
		this.state.wifiKey = this.refs.wifiKey.value;
		this.state.uplinkSsid = this.refs.uplinkSsid ? this.refs.uplinkSsid.value.trim() : '';
		this.state.uplinkKey = this.refs.uplinkKey ? this.refs.uplinkKey.value : '';
		this.state.uplinkBand = this.refs.uplinkBand ? this.refs.uplinkBand.value : '2g';
		this.state.meshId = this.refs.meshId ? this.refs.meshId.value.trim() : '';
		this.state.meshKey = this.refs.meshKey ? this.refs.meshKey.value : '';
		this.state.meshBand = this.refs.meshBand ? this.refs.meshBand.value : '2g';
		this.state.isVlan = this.refs.isVlan.checked;
		this.state.vlanId = this.refs.vlanId.value.trim();
		this.state.channel2g = this.refs.channel2g ? this.refs.channel2g.value : 'auto';
		this.state.channel5g = this.refs.channel5g ? this.refs.channel5g.value : 'auto';
		this.state.resetDisabled = this.refs.resetDisabled.checked;
		this.state.resetHoldSeconds = this.refs.resetHoldSeconds.value;
		this.state.wpsDisabled = this.refs.wpsDisabled.checked;
		this.state.rebootEnabled = this.refs.rebootEnabled ? this.refs.rebootEnabled.checked : false;
		this.state.rebootHours = this.refs.rebootHours ? this.refs.rebootHours.value.trim() : '24';
		this.state.adminPassword = this.refs.adminPassword ? this.refs.adminPassword.value : '';
		this.state.adminPasswordConfirm = this.refs.adminPasswordConfirm ? this.refs.adminPasswordConfirm.value : '';
	},

	describeModePlan: function() {
		var radio2g = getRadioByBand(this.radios || [], '2g');
		var remainingBands = getRemainingLocalBands(this.radios || [], this.state);
		var onlyBand = remainingBands[0];
		var uplinkBand = getRadioByBand(this.radios || [], this.state.uplinkBand) ? this.state.uplinkBand : (radio2g ? '2g' : '5g');
		var meshBand = getRadioByBand(this.radios || [], this.state.meshBand) ? this.state.meshBand : (radio2g ? '2g' : '5g');

		if (this.state.mode == 'ap_wds') {
			if (!remainingBands.length)
				return _('No local AP radio is currently available to host Access Point + WDS mode.');

			if (remainingBands.length == 1)
				return _('Access Point + WDS will stay active on the local AP on ') + bandLabel(onlyBand) + _(', and WDS will be enabled on that interface.');

			return _('Access Point + WDS will stay active on both local AP radios, and WDS will be enabled on both interfaces.');
		}

		if (this.state.mode == 'sta_wds') {
			if (!remainingBands.length)
				return _('Client + WDS will use ') + bandLabel(uplinkBand) + _(' for the uplink. No local AP will remain active on Wi-Fi, but LAN access stays available.');

			if (remainingBands.length == 1)
				return _('Client + WDS will use ') + bandLabel(uplinkBand) + _(' for the uplink, while the remaining local AP on ') + bandLabel(onlyBand) + _(' stays available.');

			return _('Client + WDS will use ') + bandLabel(uplinkBand) + _(' for the uplink, while the remaining local AP radios stay available.');
		}

		if (this.state.mode == 'mesh') {
			if (!remainingBands.length)
				return _('Mesh will use ') + bandLabel(meshBand) + _(' as the backhaul radio. No local AP will remain active on Wi-Fi, but LAN access stays available.');

			if (remainingBands.length == 1)
				return _('Mesh will use ') + bandLabel(meshBand) + _(' as the backhaul radio, while the remaining local AP on ') + bandLabel(onlyBand) + _(' stays available.');

			return _('Mesh will use ') + bandLabel(meshBand) + _(' as the backhaul radio, while the remaining local AP radios stay available.');
		}

		if (!remainingBands.length)
			return _('No local AP radio is currently available for Access Point mode.');

		if (remainingBands.length == 1)
			return _('Access Point mode will stay active on the local AP on ') + bandLabel(onlyBand) + _('.');

		return _('Access Point mode will stay active on both local AP radios.');
	},

	describeSecondaryNetworkPlan: function() {
		var vlanId = this.state.vlanId || '10';
		var vlanBinding = describeSecondaryVlanBinding(vlanId);
		
		var secondary2g = secondarySsid(this.state.wifiSsid, '2g');
		var secondary5g = secondarySsid(this.state.wifiSsid, '5g');
		var remainingBands = getRemainingLocalBands(this.radios || [], this.state);
		var remainingCount = remainingBands.length;
		var onlyBand = remainingCount ? remainingBands[0] : null;
		var wdsSummary = (this.state.mode == 'ap_wds')
			? _(' In Access Point + WDS mode, the secondary local AP interfaces will also keep WDS enabled.')
			: '';

		if (!this.state.isVlan)
			return _('Disabled. The primary LAN and the selected operating mode stay on the main LAN only.');

		if (!remainingCount)
			return _('Enabled, but no radio will remain available for a local AP in the selected mode. The primary LAN and any WDS, uplink, or Mesh backhaul stay on LAN, and ') + vlanBinding + _(' will be prepared without a secondary Wi-Fi SSID.');

		if (remainingCount == 1)
			return _('Enabled. The primary LAN and any WDS, uplink, or Mesh backhaul stay on LAN. Only the remaining local AP on ') + bandLabel(onlyBand) + _(' will host the secondary SSID ') + secondarySsid(this.state.wifiSsid, onlyBand) + _(' attached to ') + vlanBinding + _('.') + wdsSummary;

		return _('Enabled. The primary LAN and any WDS, uplink, or Mesh backhaul stay on LAN. Additional local AP SSIDs ') + secondary2g + _(' and ') + secondary5g + _(' will be attached to ') + vlanBinding + _(' on radios that remain available for local AP service.') + wdsSummary;
	},

	updateStepUi: function() {
		var i;
		var lastStep = this.stepPanels.length - 1;
		var vlanBinding;
		var meshBandIs5g;
		var meshChannel;

		this.collectState();
		vlanBinding = describeSecondaryVlanBinding(this.state.vlanId);
		meshBandIs5g = (this.state.meshBand == '5g');
		meshChannel = meshBandIs5g ? this.state.channel5g : this.state.channel2g;

		for (i = 0; i < this.stepPanels.length; i++) {
			this.stepPanels[i].style.display = (i == this.stepIndex) ? '' : 'none';
			this.stepBadges[i].style.background = (i == this.stepIndex) ? '#0b5ed7' : '#d0d7de';
			this.stepBadges[i].style.color = (i == this.stepIndex) ? '#fff' : '#222';
		}

		this.refs.backButton.disabled = (this.stepIndex === 0);
		this.refs.nextButton.style.display = (this.stepIndex === lastStep) ? 'none' : '';
		this.refs.saveButton.style.display = (this.stepIndex === lastStep) ? '' : 'none';
		this.refs.uplinkSettingsWrapper.style.display = (this.state.mode == 'sta_wds') ? '' : 'none';
		this.refs.meshSettingsWrapper.style.display = (this.state.mode == 'mesh') ? '' : 'none';
		this.refs.vlanIdWrapper.style.display = this.refs.isVlan.checked ? '' : 'none';
		this.refs.vlanPreviewWrapper.style.display = this.refs.isVlan.checked ? '' : 'none';
		this.refs.resetHoldWrapper.style.display = this.refs.resetDisabled.checked ? 'none' : '';
		this.refs.rebootHoursWrapper.style.display = this.refs.rebootEnabled.checked ? '' : 'none';
		var hasLocal5g = (getRemainingLocalBands(this.radios || [], this.state).indexOf('5g') != -1);
		if (this.refs.ssid5gModeRow)
			this.refs.ssid5gModeRow.style.display = hasLocal5g ? '' : 'none';
		if (this.refs.ssid5gCustomRow)
			this.refs.ssid5gCustomRow.style.display = (hasLocal5g && this.state.wifiSsid5gMode == 'custom') ? '' : 'none';
		if (this.refs.ssidPreviewRow)
			this.refs.ssidPreviewRow.style.display = hasLocal5g ? '' : 'none';
		this.refs.ssidPreview.textContent = primarySsid(this.state, '5g');
		if (this.refs.wifiNameHelp)
			this.refs.wifiNameHelp.textContent = describePrimaryWifiNamingHelp(this.state, this.radios || []);
		this.refs.vlanPreview.textContent = vlanBinding;
		if (this.refs.secondaryNetworkIntro)
			this.refs.secondaryNetworkIntro.textContent = describeSecondaryNetworkIntro(this.state, this.radios || []);
		if (this.refs.secondarySubnetHelp)
			this.refs.secondarySubnetHelp.textContent = describeSecondarySubnetHelp(this.state, this.radios || []);
		if (this.refs.uplinkHelp)
			this.refs.uplinkHelp.textContent = describeUplinkSettingsHelp(this.state, this.radios || []);
		if (this.refs.meshHelp)
			this.refs.meshHelp.textContent = describeMeshSettingsHelp(this.state, this.radios || []);

		if (this.refs.channel2gRow) {
			this.refs.channel2gRow.style.border = (this.state.mode == 'mesh' && !meshBandIs5g) ? '1px solid #0b5ed7' : '1px solid transparent';
			this.refs.channel2gRow.style.background = (this.state.mode == 'mesh' && !meshBandIs5g) ? '#eef4ff' : 'transparent';
			this.refs.channel2gRow.style.borderRadius = '8px';
			this.refs.channel2gRow.style.padding = '8px 10px';
		}

		if (this.refs.channel5gRow) {
			this.refs.channel5gRow.style.border = (this.state.mode == 'mesh' && meshBandIs5g) ? '1px solid #0b5ed7' : '1px solid transparent';
			this.refs.channel5gRow.style.background = (this.state.mode == 'mesh' && meshBandIs5g) ? '#eef4ff' : 'transparent';
			this.refs.channel5gRow.style.borderRadius = '8px';
			this.refs.channel5gRow.style.padding = '8px 10px';
		}

		if (this.refs.meshChannelHelp) {
			if (this.state.mode == 'mesh') {
				this.refs.meshChannelHelp.style.display = '';
				this.refs.meshChannelHelp.textContent = describeMeshChannelHelp(this.state, this.radios || []);
			}
			else {
				this.refs.meshChannelHelp.style.display = 'none';
				this.refs.meshChannelHelp.textContent = '';
			}
		}

		if (this.refs.modePlan)
			this.refs.modePlan.textContent = this.describeModePlan();

		if (this.refs.primaryWifiPlan)
			this.refs.primaryWifiPlan.textContent = describePrimaryWifiPlan(this.state, this.radios || []);

		if (this.refs.secondaryNetworkPlan)
			this.refs.secondaryNetworkPlan.textContent = this.describeSecondaryNetworkPlan();

		if (this.refs.secondaryNetworkNotice) {
			this.refs.secondaryNetworkNotice.textContent = describeSecondaryNetworkNotice(this.state, this.radios || []);
			this.refs.secondaryNetworkNotice.style.display = this.state.isVlan ? '' : 'none';
		}
	},

	validateStep: function(index) {
		this.collectState();

		if (STEP_KEYS[index] == 'lan') {
			if (!isIPv4(this.state.lanIpaddr)) {
				notify(_('Please enter a valid LAN IPv4 address.'));
				return false;
			}

			if (!isIPv4(this.state.lanNetmask)) {
				notify(_('Please enter a valid LAN netmask.'));
				return false;
			}
		}

		if (STEP_KEYS[index] == 'mode') {
			if (normalizeMode(this.state.mode) != this.state.mode) {
				notify(_('Please choose a valid operating mode.'));
				return false;
			}
		}

		if (STEP_KEYS[index] == 'wifi') {
			var uplinkRadio = getRadioByBand(this.radios || [], this.state.uplinkBand);
			var meshRadio = getRadioByBand(this.radios || [], this.state.meshBand);
			var hasLocal5g = (getRemainingLocalBands(this.radios || [], this.state).indexOf('5g') != -1);

			if (!this.state.wifiSsid) {
				notify(_('Please enter a base wireless name.'));
				return false;
			}

			if (hasLocal5g && this.state.wifiSsid5gMode == 'custom' && !this.state.wifiSsid5g) {
				notify(_('Please enter a custom 5GHz SSID or switch back to automatic naming.'));
				return false;
			}

			if (this.state.wifiKey && this.state.wifiKey.length < 8) {
				notify(_('Wireless password must be at least 8 characters or empty for open Wi-Fi.'));
				return false;
			}

			if (this.state.mode == 'sta_wds') {
				if (!this.state.uplinkSsid) {
					notify(_('Please enter the uplink SSID for Client + WDS mode.'));
					return false;
				}

				if (this.state.uplinkBand != '2g' && this.state.uplinkBand != '5g') {
					notify(_('Please choose the uplink radio band.'));
					return false;
				}

				if (!uplinkRadio) {
					notify(_('The selected uplink band is not available on this device.'));
					return false;
				}

				if (this.state.uplinkKey && this.state.uplinkKey.length < 8) {
					notify(_('Uplink password must be at least 8 characters or empty for open uplink Wi-Fi.'));
					return false;
				}
			}

			if (this.state.mode == 'mesh') {
				if (!this.state.meshId) {
					notify(_('Please enter the Mesh ID.'));
					return false;
				}

				if (this.state.meshBand != '2g' && this.state.meshBand != '5g') {
					notify(_('Please choose the Mesh radio band.'));
					return false;
				}

				if (!meshRadio) {
					notify(_('The selected Mesh band is not available on this device.'));
					return false;
				}

				if (this.state.meshKey && this.state.meshKey.length < 8) {
					notify(_('Mesh password must be at least 8 characters or empty for open Mesh.'));
					return false;
				}
			}
		}

		if (STEP_KEYS[index] == 'vlan' && this.state.isVlan) {
			var vlanId = +this.state.vlanId;

			if (!(vlanId >= 1 && vlanId <= 4094)) {
				notify(_('Please choose a VLAN ID between 1 and 4094.'));
				return false;
			}
		}

		if (STEP_KEYS[index] == 'channel') {
			if (this.state.mode == 'mesh') {
				var meshChannel = (this.state.meshBand == '5g') ? this.state.channel5g : this.state.channel2g;

				if (!meshChannel || meshChannel == 'auto') {
					notify(_('Please select a fixed channel for the chosen Mesh band.'));
					return false;
				}
			}

			if (this.state.rebootEnabled && !/^[1-9][0-9]*$/.test(this.state.rebootHours)) {
				notify(_('Please enter the periodic reboot interval as whole hours greater than zero.'));
				return false;
			}

			if ((this.state.adminPassword || this.state.adminPasswordConfirm) &&
			    (!this.state.adminPassword || !this.state.adminPasswordConfirm)) {
				notify(_('Please enter and confirm the administrator password.'));
				return false;
			}

			if (this.state.adminPassword != this.state.adminPasswordConfirm) {
				notify(_('Administrator password confirmation did not match.'));
				return false;
			}
		}
		return true;
	},

	nextStep: function() {
		if (!this.validateStep(this.stepIndex))
			return;

		if (this.stepIndex < this.stepPanels.length - 1) {
			this.stepIndex++;
			this.updateStepUi();
		}
	},

	prevStep: function() {
		this.collectState();

		if (this.stepIndex > 0) {
			this.stepIndex--;
			this.updateStepUi();
		}
	},

	applyWifiSettings: function(state, radios) {
		var radio2g = getRadioByBand(radios, '2g');
		var radio5g = getRadioByBand(radios, '5g');
		var requestedMode = normalizeMode(state.mode);
		var lanPolicy = getLocalApPolicy(state, 'lan');
		var vlanPolicy = getLocalApPolicy(state, 'wizardvlan');
		var uplinkRadio = null;
		var uplinkApIface = null;
		var uplinkStaIface = null;
		var meshRadio = null;
		var meshApIface = null;
		var meshIface = null;
		var secondaryIface2g = radio2g ? secondaryApSectionName(radio2g['.name']) : null;
		var secondaryIface5g = radio5g ? secondaryApSectionName(radio5g['.name']) : null;
		var iface;
		var localRadios;

		if (requestedMode == 'sta_wds') {
			uplinkRadio = getRadioByBand(radios, state.uplinkBand);

			if (uplinkRadio == null)
				uplinkRadio = radio2g || radio5g;

			uplinkStaIface = ensureNamedWifiIface('wizard_uplink');
			uci.set('wireless', uplinkStaIface, 'device', wifiDeviceName(uplinkRadio));
			uci.set('wireless', uplinkStaIface, 'mode', 'sta');
			uci.set('wireless', uplinkStaIface, 'network', 'lan');
			uci.set('wireless', uplinkStaIface, 'disabled', '0');
			uci.set('wireless', uplinkStaIface, 'ssid', state.uplinkSsid);
			uci.set('wireless', uplinkStaIface, 'wds', '1');
			uci.unset('wireless', uplinkStaIface, 'mesh_id');
			setWifiSecurity('wireless', uplinkStaIface, state.uplinkKey);

			uplinkApIface = uplinkRadio ? findWifiIface(uplinkRadio['.name']) : null;

			if (uplinkApIface && uplinkApIface != uplinkStaIface)
				uci.set('wireless', uplinkApIface, 'disabled', '1');

			if (uplinkRadio)
				uci.set('wireless', uplinkRadio['.name'], 'channel', 'auto');
		}
		else {
			uci.remove('wireless', 'wizard_uplink');
		}

		if (requestedMode == 'mesh') {
			meshRadio = getRadioByBand(radios, state.meshBand);

			if (meshRadio == null)
				meshRadio = radio2g || radio5g;

			meshIface = ensureNamedWifiIface('wizard_mesh');
			uci.set('wireless', meshIface, 'device', wifiDeviceName(meshRadio));
			uci.set('wireless', meshIface, 'mode', 'mesh');
			uci.set('wireless', meshIface, 'network', 'lan');
			uci.set('wireless', meshIface, 'disabled', '0');
			uci.set('wireless', meshIface, 'mesh_id', state.meshId);
			uci.unset('wireless', meshIface, 'ssid');
			uci.unset('wireless', meshIface, 'wds');

			if (state.meshKey) {
				uci.set('wireless', meshIface, 'encryption', 'sae');
				uci.set('wireless', meshIface, 'key', state.meshKey);
			}
			else {
				uci.set('wireless', meshIface, 'encryption', 'none');
				uci.unset('wireless', meshIface, 'key');
			}

			meshApIface = meshRadio ? findWifiIface(meshRadio['.name']) : null;

			if (meshApIface && meshApIface != meshIface)
				uci.set('wireless', meshApIface, 'disabled', '1');

			if (meshRadio) {
				uci.set('wireless', meshRadio['.name'], 'channel', state.meshBand == '5g' ? (state.channel5g || 'auto') : (state.channel2g || 'auto'));
			}
		}
		else {
			uci.remove('wireless', 'wizard_mesh');
		}

		localRadios = radios.filter(function(radio) {
			return (!uplinkRadio || radio['.name'] != uplinkRadio['.name']) && (!meshRadio || radio['.name'] != meshRadio['.name']);
		});

		if (radio2g && (!uplinkRadio || radio2g['.name'] != uplinkRadio['.name']) && (!meshRadio || radio2g['.name'] != meshRadio['.name'])) {
			iface = ensureWifiIface(radio2g['.name']);
			configureApIface(iface, radio2g['.name'], 'lan', primarySsid(state, '2g'), state.wifiKey, lanPolicy);

			uci.set('wireless', radio2g['.name'], 'channel', state.channel2g || 'auto');

			if (state.isVlan) {
				ensureNamedWifiIface(secondaryIface2g);
				configureApIface(secondaryIface2g, radio2g['.name'], 'wizardvlan', secondarySsid(state.wifiSsid, '2g'), state.wifiKey, vlanPolicy);
			}
			else {
				uci.remove('wireless', secondaryIface2g);
			}
		}
		else if (secondaryIface2g) {
			uci.remove('wireless', secondaryIface2g);
		}

		if (radio5g && (!uplinkRadio || radio5g['.name'] != uplinkRadio['.name']) && (!meshRadio || radio5g['.name'] != meshRadio['.name'])) {
			iface = ensureWifiIface(radio5g['.name']);
			configureApIface(iface, radio5g['.name'], 'lan', primarySsid(state, '5g'), state.wifiKey, lanPolicy);

			uci.set('wireless', radio5g['.name'], 'channel', state.channel5g || 'auto');

			if (state.isVlan) {
				ensureNamedWifiIface(secondaryIface5g);
				configureApIface(secondaryIface5g, radio5g['.name'], 'wizardvlan', secondarySsid(state.wifiSsid, '5g'), state.wifiKey, vlanPolicy);
			}
			else {
				uci.remove('wireless', secondaryIface5g);
			}
		}
		else if (secondaryIface5g) {
			uci.remove('wireless', secondaryIface5g);
		}

	},

	applyVlanSettings: function(state) {
		var firewallLanZone = findFirewallZone('lan');

		if (state.isVlan) {
			ensureNamedSection('network', 'wizard_vlan_dev', 'device');
			ensureNamedSection('network', 'wizard_vlan_bridge', 'device');
			ensureNamedSection('network', 'wizardvlan', 'interface');
			uci.set('network', 'wizard_vlan_dev', 'type', '8021q');
			uci.set('network', 'wizard_vlan_dev', 'ifname', 'br-lan');
			uci.set('network', 'wizard_vlan_dev', 'vid', state.vlanId);
			uci.set('network', 'wizard_vlan_dev', 'name', 'br-lan.' + state.vlanId);

			uci.set('network', 'wizard_vlan_bridge', 'type', 'bridge');
			uci.set('network', 'wizard_vlan_bridge', 'name', 'vlan_' + state.vlanId);
			uci.set('network', 'wizard_vlan_bridge', 'bridge_empty', '1');
			uci.set('network', 'wizard_vlan_bridge', 'ipv6', '0');
			uci.set('network', 'wizard_vlan_bridge', 'ports', [ 'br-lan.' + state.vlanId ]);

			uci.set('network', 'wizardvlan', 'proto', 'none');
			uci.set('network', 'wizardvlan', 'device', 'vlan_' + state.vlanId);
			uci.unset('network', 'wizardvlan', 'ipaddr');
			uci.unset('network', 'wizardvlan', 'netmask');
			uci.unset('network', 'wizardvlan', 'gateway');
			uci.unset('network', 'wizardvlan', 'ip6addr');
			uci.unset('network', 'wizardvlan', 'ip6gw');
			uci.unset('network', 'wizardvlan', 'ip6assign');
			uci.unset('network', 'wizardvlan', 'ip6hint');
			uci.unset('network', 'wizardvlan', 'ip6class');
			uci.unset('network', 'wizardvlan', 'delegate');
			uci.unset('network', 'wizardvlan', 'dns');
			uci.unset('network', 'wizardvlan', 'defaultroute');

			uci.remove('dhcp', 'wizardvlan');

			if (firewallLanZone)
				removeListValue('firewall', firewallLanZone, 'network', 'wizardvlan');
		}
		else {
			uci.remove('network', 'wizard_vlan_dev');
			uci.remove('network', 'wizard_vlan_bridge');
			uci.remove('network', 'wizardvlan');
			uci.remove('dhcp', 'wizardvlan');

			if (firewallLanZone)
				removeListValue('firewall', firewallLanZone, 'network', 'wizardvlan');
		}
	},

	applyPeriodicRebootSettings: function(state) {
		if (state.rebootEnabled) {
			ensureNamedSection('watchcat', WATCHCAT_SID, 'watchcat');
			uci.set('watchcat', WATCHCAT_SID, 'mode', 'periodic_reboot');
			uci.set('watchcat', WATCHCAT_SID, 'period', formatRebootPeriod(state.rebootHours));
			uci.set('watchcat', WATCHCAT_SID, 'forcedelay', '1m');
			uci.unset('watchcat', WATCHCAT_SID, 'pinghosts');
			uci.unset('watchcat', WATCHCAT_SID, 'pingperiod');
			uci.unset('watchcat', WATCHCAT_SID, 'pingsize');
			uci.unset('watchcat', WATCHCAT_SID, 'interface');
			uci.unset('watchcat', WATCHCAT_SID, 'mmifacename');
			uci.unset('watchcat', WATCHCAT_SID, 'unlockbands');
			uci.unset('watchcat', WATCHCAT_SID, 'addressfamily');
			uci.unset('watchcat', WATCHCAT_SID, 'script');
		}
		else {
			uci.remove('watchcat', WATCHCAT_SID);
		}
	},

	saveAndApply: function() {
		var self = this;
		var oldLanIpaddr = uci.get('network', 'lan', 'ipaddr') || this.state.lanIpaddr;
		var oldSsid = this.state.wifiSsid;

		if (!this.validateStep(this.stepIndex))
			return;

		this.collectState();

		ensureNamedSection('setup', 'default', 'setup');

		uci.set('setup', 'default', 'lan_ipaddr', this.state.lanIpaddr);
		uci.set('setup', 'default', 'lan_netmask', this.state.lanNetmask);
		uci.set('setup', 'default', 'mode', this.state.mode);
		uci.set('setup', 'default', 'wifi_ssid', this.state.wifiSsid);
		uci.set('setup', 'default', 'wifi_ssid_5g_mode', this.state.wifiSsid5gMode || 'derived');
		uci.set('setup', 'default', 'wifi_ssid_5g', this.state.wifiSsid5g || '');
		uci.set('setup', 'default', 'wifi_key', this.state.wifiKey);
		uci.set('setup', 'default', 'uplink_ssid', this.state.uplinkSsid);
		uci.set('setup', 'default', 'uplink_key', this.state.uplinkKey);
		uci.set('setup', 'default', 'uplink_band', this.state.uplinkBand);
		uci.set('setup', 'default', 'mesh_id', this.state.meshId);
		uci.set('setup', 'default', 'mesh_key', this.state.meshKey);
		uci.set('setup', 'default', 'mesh_band', this.state.meshBand);
		uci.set('setup', 'default', 'is_vlan', this.state.isVlan ? '1' : '0');
		uci.set('setup', 'default', 'vlan_id', this.state.vlanId || '10');
		uci.set('setup', 'default', 'channel_2g', this.state.channel2g || 'auto');
		uci.set('setup', 'default', 'channel_5g', this.state.channel5g || 'auto');
		uci.set('setup', 'default', 'reset_button_disabled', this.state.resetDisabled ? '1' : '0');
		uci.set('setup', 'default', 'reset_hold_seconds', this.state.resetHoldSeconds || '5');
		uci.set('setup', 'default', 'wps_button_disabled', this.state.wpsDisabled ? '1' : '0');

		uci.set('network', 'lan', 'ipaddr', this.state.lanIpaddr);
		uci.set('network', 'lan', 'netmask', this.state.lanNetmask);
		this.applyVlanSettings(this.state);
		this.applyWifiSettings(this.state, this.radios);
		this.applyPeriodicRebootSettings(this.state);

		this.refs.saveButton.disabled = true;
		this.refs.saveButton.textContent = _('Applying...');

		uci.save().then(function() {
			return ui.changes.apply();
		}).then(function() {
			var changedIp = self.state.lanIpaddr != oldLanIpaddr;

			if (!self.state.adminPassword) {
				return {
					changedIp: changedIp,
					passwordChanged: null
				};
			}

			return L.resolveDefault(callSetPassword('root', self.state.adminPassword), false).then(function(success) {
				return {
					changedIp: changedIp,
					passwordChanged: !!success
				};
			});
		}).then(function(result) {
			var nextUrl;
			var modeMessage = describeAppliedModeResult(self.state, self.radios || []);
			var secondaryNetworkMessage = describeAppliedSecondaryNetworkResult(self.state, self.radios || []);
			var reconnectMessage = describeReconnectHint(self.state, self.radios || [], oldSsid);

			self.refs.saveButton.disabled = false;
			self.refs.saveButton.textContent = _('Save & Apply');
			self.refs.adminPassword.value = '';
			self.refs.adminPasswordConfirm.value = '';
			self.state.adminPassword = '';
			self.state.adminPasswordConfirm = '';

			if (result.passwordChanged === true)
				notify(_('Administrator password changed successfully.'));
			else if (result.passwordChanged === false)
				notify(_('Settings were applied, but changing the administrator password failed.'));

			if (modeMessage)
				notify(modeMessage);

			if (secondaryNetworkMessage)
				notify(secondaryNetworkMessage);

			if (result.changedIp) {
				notify(_('Settings applied. The LAN IP changed to ') + self.state.lanIpaddr + _('. The page will reopen on the new address in a few seconds.'));
				nextUrl = window.location.protocol + '//' + self.state.lanIpaddr + '/cgi-bin/luci/admin/applications/alemprator';
				window.setTimeout(function() {
					window.location.href = nextUrl;
				}, 8000);
			}
			else {
				notify(_('Settings applied successfully.'));
			}

			if (reconnectMessage)
				notify(reconnectMessage);
		}).catch(function(err) {
			self.refs.saveButton.disabled = false;
			self.refs.saveButton.textContent = _('Save & Apply');
			notify(_('Unable to apply the wizard settings.') + ' ' + (err || ''));
		});
	},

	render: function(data) {
		var self = this;
		var statusContainer = E('div');
		var wizardContainer = E('div', { 'class': 'cbi-section' });
		var radios = uci.sections('wireless', 'wifi-device');
		var frequencyMap = Array.isArray(data) ? (data[data.length - 1] || {}) : {};
		var radio2g = getRadioByBand(radios, '2g');
		var radio5g = getRadioByBand(radios, '5g');
		var stepNav = E('div', { 'style': 'display:flex; gap:10px; flex-wrap:wrap; margin:0 0 16px 0;' });
		var stepsWrap = E('div', { 'class': 'cbi-section-node' });
		var actions = E('div', { 'style': 'display:flex; gap:10px; justify-content:flex-end; margin-top:18px;' });
		var panel = E('div');
		var wizardIntro;
		var stepTitles = [ _('Step 1: LAN'), _('Step 2: Mode'), _('Step 3: Wi-Fi'), _('Step 4: Secondary Network'), _('Step 5: Channels') ];
		var stepPanels = [];
		var stepBadges = [];
		var i;

		this.radios = radios;
		this.frequencyMap = frequencyMap;
		this.state = this.readState(radios);
		this.stepIndex = 0;
		this.refs = {};
		this.stepPanels = stepPanels;
		this.stepBadges = stepBadges;

		panel.appendChild(statusContainer);

		wizardIntro = E('div', { 'class': 'cbi-section-node', 'style': 'margin-bottom:14px;' }, [
			E('h3', _('Quick Setup Wizard')),
			E('p', _('This wizard guides you through the LAN IP, operating mode, Wi-Fi settings, an optional secondary client network plan, and channel selection step by step.'))
		]);

		wizardContainer.appendChild(wizardIntro);

		for (i = 0; i < stepTitles.length; i++) {
			var badge = E('div', {
				'style': 'display:flex; align-items:center; gap:8px; padding:8px 12px; border:1px solid #d0d7de; border-radius:999px; background:#fff;'
			}, [
				E('span', {
					'style': 'display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; border-radius:50%; font-weight:bold; background:#d0d7de; color:#222;'
				}, String(i + 1)),
				E('span', stepTitles[i])
			]);

			stepBadges.push(badge.firstChild);
			stepNav.appendChild(badge);
		}

		wizardContainer.appendChild(stepNav);

		this.refs.lanIpaddr = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'value': this.state.lanIpaddr, 'style': 'max-width:280px;' });
		this.refs.lanNetmask = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'value': this.state.lanNetmask, 'style': 'max-width:280px;' });
		this.refs.mode = E('select', { 'class': 'cbi-input-select', 'style': 'max-width:280px;' }, [
			E('option', { 'value': 'ap' }, _('Access Point')),
			E('option', { 'value': 'ap_wds' }, _('Access Point + WDS')),
			E('option', { 'value': 'sta_wds' }, _('Client + WDS')),
			E('option', { 'value': 'mesh' }, _('Mesh'))
		]);
		this.refs.mode.value = this.state.mode;
		this.refs.wifiSsid = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'value': this.state.wifiSsid, 'style': 'max-width:280px;' });
		this.refs.wifiSsid5gMode = E('select', { 'class': 'cbi-input-select', 'style': 'max-width:220px;' }, [
			E('option', { 'value': 'derived' }, _('Generate 5GHz name automatically')),
			E('option', { 'value': 'custom' }, _('Set a custom 5GHz name'))
		]);
		this.refs.wifiSsid5gMode.value = this.state.wifiSsid5gMode || 'derived';
		this.refs.wifiSsid5g = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'value': this.state.wifiSsid5g, 'style': 'max-width:280px;' });
		this.refs.wifiKey = E('input', { 'class': 'cbi-input-password', 'type': 'password', 'value': this.state.wifiKey, 'style': 'max-width:280px;' });
		this.refs.uplinkSsid = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'value': this.state.uplinkSsid, 'style': 'max-width:280px;' });
		this.refs.uplinkKey = E('input', { 'class': 'cbi-input-password', 'type': 'password', 'value': this.state.uplinkKey, 'style': 'max-width:280px;' });
		this.refs.meshId = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'value': this.state.meshId, 'style': 'max-width:280px;' });
		this.refs.meshKey = E('input', { 'class': 'cbi-input-password', 'type': 'password', 'value': this.state.meshKey, 'style': 'max-width:280px;' });
		this.refs.uplinkBand = E('select', { 'class': 'cbi-input-select', 'style': 'max-width:180px;' }, [
			radio2g ? E('option', { 'value': '2g' }, _('2.4GHz radio')) : null,
			radio5g ? E('option', { 'value': '5g' }, _('5GHz radio')) : null
		]);
		this.refs.meshBand = E('select', { 'class': 'cbi-input-select', 'style': 'max-width:180px;' }, [
			radio2g ? E('option', { 'value': '2g' }, _('2.4GHz radio')) : null,
			radio5g ? E('option', { 'value': '5g' }, _('5GHz radio')) : null
		]);

		if ((this.state.uplinkBand == '5g' && !radio5g) || (this.state.uplinkBand == '2g' && !radio2g))
			this.state.uplinkBand = radio2g ? '2g' : '5g';

		if ((this.state.meshBand == '5g' && !radio5g) || (this.state.meshBand == '2g' && !radio2g))
			this.state.meshBand = radio2g ? '2g' : '5g';

		this.refs.uplinkBand.value = this.state.uplinkBand;
		this.refs.meshBand.value = this.state.meshBand;
		this.refs.ssidPreview = E('strong', primarySsid(this.state, '5g'));
		this.refs.primaryWifiPlan = E('span');
		this.refs.isVlan = E('input', { 'type': 'checkbox' });
		this.refs.isVlan.checked = this.state.isVlan;
		this.refs.vlanId = E('input', { 'class': 'cbi-input-text', 'type': 'number', 'min': '1', 'max': '4094', 'value': this.state.vlanId, 'style': 'max-width:140px;' });
		this.refs.vlanPreview = E('strong', describeSecondaryVlanBinding(this.state.vlanId));
		this.refs.secondaryNetworkPlan = E('span');
		this.refs.secondaryNetworkNotice = E('div', {
			'style': 'display:none; margin-top:12px; padding:10px 12px; border:1px solid #8fb3ff; border-radius:8px; background:#eef4ff; color:#1f3b6d;'
		}, describeSecondaryNetworkNotice(this.state, this.radios || []));
		this.refs.channel2g = radio2g ? E('select', { 'class': 'cbi-input-select', 'style': 'max-width:180px;' }) : null;
		this.refs.channel5g = radio5g ? E('select', { 'class': 'cbi-input-select', 'style': 'max-width:180px;' }) : null;
		this.refs.resetDisabled = E('input', { 'type': 'checkbox' });
		this.refs.resetDisabled.checked = this.state.resetDisabled;
		this.refs.resetHoldSeconds = E('select', { 'class': 'cbi-input-select', 'style': 'max-width:180px;' }, [
			E('option', { 'value': '5' }, _('5 seconds')),
			E('option', { 'value': '10' }, _('10 seconds')),
			E('option', { 'value': '20' }, _('20 seconds')),
			E('option', { 'value': '30' }, _('30 seconds')),
			E('option', { 'value': '40' }, _('40 seconds')),
			E('option', { 'value': '60' }, _('60 seconds'))
		]);
		this.refs.resetHoldSeconds.value = this.state.resetHoldSeconds;
		this.refs.wpsDisabled = E('input', { 'type': 'checkbox' });
		this.refs.wpsDisabled.checked = this.state.wpsDisabled;
		this.refs.rebootEnabled = E('input', { 'type': 'checkbox' });
		this.refs.rebootEnabled.checked = this.state.rebootEnabled;
		this.refs.rebootHours = E('input', { 'class': 'cbi-input-text', 'type': 'number', 'min': '1', 'step': '1', 'value': this.state.rebootHours, 'style': 'max-width:140px;' });
		this.refs.adminPassword = E('input', { 'class': 'cbi-input-password', 'type': 'password', 'autocomplete': 'new-password', 'style': 'max-width:280px;' });
		this.refs.adminPasswordConfirm = E('input', { 'class': 'cbi-input-password', 'type': 'password', 'autocomplete': 'new-password', 'style': 'max-width:280px;' });

		if (this.refs.channel2g) {
			populateSelectOptions(
				this.refs.channel2g,
				channelChoices('2g', radio2g ? frequencyMap[radio2g['.name']] : null),
				this.state.channel2g
			);
		}

		if (this.refs.channel5g) {
			populateSelectOptions(
				this.refs.channel5g,
				channelChoices('5g', radio5g ? frequencyMap[radio5g['.name']] : null),
				this.state.channel5g
			);
		}

		stepPanels.push(E('div', { 'class': 'cbi-section-node' }, [
			E('h4', _('Set the router LAN address')),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('LAN IPv4 address')), E('div', { 'class': 'cbi-value-field' }, [ this.refs.lanIpaddr ]) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('LAN netmask')), E('div', { 'class': 'cbi-value-field' }, [ this.refs.lanNetmask ]) ])
		]));

		stepPanels.push(E('div', { 'class': 'cbi-section-node', 'style': 'display:none;' }, [
			E('h4', _('Choose the operating mode')),
			E('p', _('All operating modes below can be applied directly from this wizard.')),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Operating mode')), E('div', { 'class': 'cbi-value-field' }, [ this.refs.mode ]) ]),
			E('div', { 'style': 'margin-top:12px; padding:10px 12px; border:1px solid #d0d7de; border-radius:8px; background:#f6f8fa; color:#333;' }, [
				E('strong', _('Mode preview') + ': '),
				(this.refs.modePlan = E('span'))
			])
		]));

		stepPanels.push(E('div', { 'class': 'cbi-section-node', 'style': 'display:none;' }, [
			E('h4', _('Choose the wireless name')),
			(this.refs.wifiNameHelp = E('p', describePrimaryWifiNamingHelp(this.state, this.radios || []))),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Base SSID')), E('div', { 'class': 'cbi-value-field' }, [ this.refs.wifiSsid ]) ]),
			(this.refs.ssid5gModeRow = E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('5GHz naming')), E('div', { 'class': 'cbi-value-field' }, [ this.refs.wifiSsid5gMode ]) ])),
			(this.refs.ssid5gCustomRow = E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Custom 5GHz SSID')), E('div', { 'class': 'cbi-value-field' }, [ this.refs.wifiSsid5g ]) ])),
			(this.refs.ssidPreviewRow = E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Generated 5GHz SSID')), E('div', { 'class': 'cbi-value-field' }, [ this.refs.ssidPreview ]) ])),
			E('div', { 'style': 'margin-top:12px; padding:10px 12px; border:1px solid #d0d7de; border-radius:8px; background:#f6f8fa; color:#333;' }, [
				E('strong', _('Primary Wi-Fi preview') + ': '),
				this.refs.primaryWifiPlan
			]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Wireless password')), E('div', { 'class': 'cbi-value-field' }, [ this.refs.wifiKey, E('div', { 'style': 'margin-top:6px; color:#666;' }, _('Leave this empty if you want open Wi-Fi.')) ]) ]),
			(this.refs.uplinkSettingsWrapper = E('div', { 'style': 'display:none;' }, [
				E('h4', { 'style': 'margin-top:18px;' }, _('Client + WDS uplink')),
				(this.refs.uplinkHelp = E('p', describeUplinkSettingsHelp(this.state, this.radios || []))),
				E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Uplink band')), E('div', { 'class': 'cbi-value-field' }, [ this.refs.uplinkBand ]) ]),
				E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Uplink SSID')), E('div', { 'class': 'cbi-value-field' }, [ this.refs.uplinkSsid ]) ]),
				E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Uplink password')), E('div', { 'class': 'cbi-value-field' }, [ this.refs.uplinkKey, E('div', { 'style': 'margin-top:6px; color:#666;' }, _('Leave this empty if the uplink Wi-Fi is open.')) ]) ])
			])),
			(this.refs.meshSettingsWrapper = E('div', { 'style': 'display:none;' }, [
				E('h4', { 'style': 'margin-top:18px;' }, _('Mesh settings')),
				(this.refs.meshHelp = E('p', describeMeshSettingsHelp(this.state, this.radios || []))),
				E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Mesh band')), E('div', { 'class': 'cbi-value-field' }, [ this.refs.meshBand ]) ]),
				E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Mesh ID')), E('div', { 'class': 'cbi-value-field' }, [ this.refs.meshId ]) ]),
				E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Mesh password')), E('div', { 'class': 'cbi-value-field' }, [ this.refs.meshKey, E('div', { 'style': 'margin-top:6px; color:#666;' }, _('Leave this empty if you want open Mesh.')) ]) ])
			]))
		]));

		this.refs.vlanIdWrapper = E('div', { 'class': 'cbi-value-field' }, [ this.refs.vlanId ]);
		stepPanels.push(E('div', { 'class': 'cbi-section-node', 'style': 'display:none;' }, [
			E('h4', _('Configure the secondary client network')),
			(this.refs.secondaryNetworkIntro = E('p', describeSecondaryNetworkIntro(this.state, this.radios || []))),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Enable a secondary client network on VLAN')), E('div', { 'class': 'cbi-value-field' }, [ this.refs.isVlan ]) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Secondary VLAN ID')), this.refs.vlanIdWrapper ]),
			(this.refs.vlanPreviewWrapper = E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Secondary VLAN bridge')), E('div', { 'class': 'cbi-value-field' }, [ this.refs.vlanPreview, (this.refs.secondarySubnetHelp = E('div', { 'style': 'margin-top:6px; color:#666;' }, describeSecondarySubnetHelp(this.state, this.radios || []))) ]) ])),
			E('div', { 'style': 'margin-top:12px; padding:10px 12px; border:1px solid #d0d7de; border-radius:8px; background:#f6f8fa; color:#333;' }, [
				E('strong', _('Secondary network preview') + ': '),
				this.refs.secondaryNetworkPlan
			]),
			this.refs.secondaryNetworkNotice
		]));

		this.refs.resetHoldWrapper = E('div', { 'class': 'cbi-value-field' }, [ this.refs.resetHoldSeconds ]);
		stepPanels.push(E('div', { 'class': 'cbi-section-node', 'style': 'display:none;' }, [
			E('h4', _('Select wireless channels')),
			(this.refs.meshChannelHelp = E('p', { 'style': 'display:none; color:#666;' })),
			radio2g ? (this.refs.channel2gRow = E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, radioLabel(radio2g)), E('div', { 'class': 'cbi-value-field' }, [ this.refs.channel2g ]) ])) : E('p', _('No 2.4GHz radio detected.')),
			radio5g ? (this.refs.channel5gRow = E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, radioLabel(radio5g)), E('div', { 'class': 'cbi-value-field' }, [ this.refs.channel5g ]) ])) : E('p', _('No 5GHz radio detected.')),
			E('h4', { 'style': 'margin-top:18px;' }, _('Advanced button policies')),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Disable reset button')), E('div', { 'class': 'cbi-value-field' }, [ this.refs.resetDisabled ]) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Factory reset hold time')), this.refs.resetHoldWrapper ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Disable WPS/Mesh button')), E('div', { 'class': 'cbi-value-field' }, [ this.refs.wpsDisabled ]) ]),
			E('h4', { 'style': 'margin-top:18px;' }, _('Automatic periodic reboot')),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Enable automatic reboot')), E('div', { 'class': 'cbi-value-field' }, [ this.refs.rebootEnabled ]) ]),
			(this.refs.rebootHoursWrapper = E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Reboot every how many hours')), E('div', { 'class': 'cbi-value-field' }, [ this.refs.rebootHours, E('div', { 'style': 'margin-top:6px; color:#666;' }, _('This creates one ALemprator-only periodic reboot rule and leaves any other Watchcat rules untouched.')) ]) ])),
			E('h4', { 'style': 'margin-top:18px;' }, _('Administrator password')),
			E('p', _('Leave both fields empty if you want to keep the current root password.')),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('New password')), E('div', { 'class': 'cbi-value-field' }, [ this.refs.adminPassword ]) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Confirm password')), E('div', { 'class': 'cbi-value-field' }, [ this.refs.adminPasswordConfirm ]) ])
		]));

		stepPanels.forEach(function(stepPanel) {
			stepsWrap.appendChild(stepPanel);
		});

		wizardContainer.appendChild(stepsWrap);

		this.refs.backButton = E('button', { 'class': 'cbi-button cbi-button-neutral' }, _('Back'));
		this.refs.nextButton = E('button', { 'class': 'cbi-button cbi-button-action important' }, _('Next'));
		this.refs.saveButton = E('button', { 'class': 'cbi-button cbi-button-save important', 'style': 'display:none;' }, _('Save & Apply'));

		this.refs.backButton.addEventListener('click', function(ev) {
			ev.preventDefault();
			self.prevStep();
		});

		this.refs.nextButton.addEventListener('click', function(ev) {
			ev.preventDefault();
			self.nextStep();
		});

		this.refs.saveButton.addEventListener('click', function(ev) {
			ev.preventDefault();
			self.saveAndApply();
		});

		this.refs.wifiSsid.addEventListener('input', function() {
			self.updateStepUi();
		});

		this.refs.lanIpaddr.addEventListener('input', function() {
			self.updateStepUi();
		});

		this.refs.mode.addEventListener('change', function() {
			self.updateStepUi();
		});

		this.refs.uplinkSsid.addEventListener('input', function() {
			self.collectState();
		});

		this.refs.uplinkKey.addEventListener('input', function() {
			self.collectState();
		});

		this.refs.uplinkBand.addEventListener('change', function() {
			self.updateStepUi();
		});

		this.refs.meshId.addEventListener('input', function() {
			self.collectState();
		});

		this.refs.meshKey.addEventListener('input', function() {
			self.collectState();
		});

		this.refs.meshBand.addEventListener('change', function() {
			self.updateStepUi();
		});

		if (this.refs.channel2g) {
			this.refs.channel2g.addEventListener('change', function() {
				self.updateStepUi();
			});
		}

		if (this.refs.channel5g) {
			this.refs.channel5g.addEventListener('change', function() {
				self.updateStepUi();
			});
		}

		this.refs.isVlan.addEventListener('change', function() {
			self.updateStepUi();
		});

		this.refs.vlanId.addEventListener('input', function() {
			self.updateStepUi();
		});

		this.refs.rebootEnabled.addEventListener('change', function() {
			self.updateStepUi();
		});

		this.refs.rebootHours.addEventListener('input', function() {
			self.collectState();
		});

		this.refs.adminPassword.addEventListener('input', function() {
			self.collectState();
		});

		this.refs.adminPasswordConfirm.addEventListener('input', function() {
			self.collectState();
		});

		this.refs.resetDisabled.addEventListener('change', function() {
			self.updateStepUi();
		});

		actions.appendChild(this.refs.backButton);
		actions.appendChild(this.refs.nextButton);
		actions.appendChild(this.refs.saveButton);
		wizardContainer.appendChild(actions);
		panel.appendChild(wizardContainer);

		this.updateStepUi();

		return this.renderStatus(statusContainer).then(function() {
			poll.add(function() {
				return self.renderStatus(statusContainer);
			});

			return panel;
		});
	}
});