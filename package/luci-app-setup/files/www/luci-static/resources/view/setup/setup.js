'use strict';
'require view';
'require dom';
'require form';
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

function radioLabel(device) {
	var label = _('Radio') + ' ' + device['.name'];

	if (device.band)
		label += ' (' + String(device.band).toUpperCase() + ')';

	return label;
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
			uci.load('network'),
			uci.load('wireless')
		]);
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

	render: function() {
		var self = this;
		var radios = uci.sections('wireless', 'wifi-device');
		var map = new form.Map('setup', _('ALemprator Setup'),
			_('Target-independent setup page for standard OpenWrt LAN, Wi-Fi and button policies. Proprietary ALemprator helper binaries are optional and are only used when present.')
		);
		var section;
		var option;
		var statusContainer = E('div');
		var panel = E('div');

		this.map = map;

		map.chain('network');
		map.chain('wireless');
		map.tabbed = true;

		panel.appendChild(statusContainer);

		section = map.section(form.NamedSection, 'default', 'setup');
		section.anonymous = true;
		section.addremove = false;
		section.tab('general', _('General'));
		section.tab('buttons', _('Buttons'));

		option = section.taboption('general', form.DummyValue, '_portable_info', _('Portable mode'));
		option.rawhtml = true;
		option.cfgvalue = function() {
			return _('This page now applies only generic OpenWrt settings, so it works across targets. Target-specific helper binaries remain optional.');
		};

		option = section.taboption('general', form.Value, 'lan_ipaddr', _('LAN IPv4 address'));
		option.rmempty = false;
		option.datatype = 'ip4addr';
		option.cfgvalue = function(section_id) {
			return uci.get('network', 'lan', 'ipaddr') || uci.get('setup', section_id, 'lan_ipaddr') || '';
		};
		option.write = function(section_id, value) {
			uci.set('network', 'lan', 'ipaddr', value);
			uci.set('setup', section_id, 'lan_ipaddr', value);
		};

		option = section.taboption('general', form.Value, 'lan_netmask', _('LAN netmask'));
		option.rmempty = false;
		option.datatype = 'ip4addr';
		option.cfgvalue = function(section_id) {
			return uci.get('network', 'lan', 'netmask') || uci.get('setup', section_id, 'lan_netmask') || '';
		};
		option.write = function(section_id, value) {
			uci.set('network', 'lan', 'netmask', value);
			uci.set('setup', section_id, 'lan_netmask', value);
		};

		option = section.taboption('buttons', form.Flag, 'reset_button_disabled', _('Disable reset button (Anti-Theft)'));
		option.rmempty = false;
		option.default = '0';
		option.description = _('Ignore reset button presses while this option is enabled.');

		option = section.taboption('buttons', form.ListValue, 'reset_hold_seconds', _('Factory reset hold time'));
		option.rmempty = false;
		option.default = '5';
		option.description = _('Choose how long the reset button must be held before factory reset is triggered.');
		option.depends('reset_button_disabled', '0');
		option.value('5', _('5 seconds (default)'));
		option.value('10', _('10 seconds'));
		option.value('20', _('20 seconds'));
		option.value('30', _('30 seconds'));
		option.value('40', _('40 seconds'));
		option.value('60', _('60 seconds'));

		option = section.taboption('buttons', form.Flag, 'wps_button_disabled', _('Disable WPS/Mesh button'));
		option.rmempty = false;
		option.default = '0';
		option.description = _('Ignore WPS or mesh button presses while this option is enabled.');

		if (!radios.length) {
			option = section.taboption('general', form.DummyValue, '_no_wireless', _('Wireless'));
			option.rawhtml = true;
			option.cfgvalue = function() {
				return _('No wireless radios were detected on this target. LAN and button settings remain available.');
			};
		}
		else {
			radios.forEach(function(device) {
				var tabId = 'radio_' + device['.name'];
				var enableOptionName = '__' + device['.name'] + '_enabled';
				var ssidOptionName = '__' + device['.name'] + '_ssid';
				var encryptionOptionName = '__' + device['.name'] + '_encryption';
				var keyOptionName = '__' + device['.name'] + '_key';

				section.tab(tabId, radioLabel(device));

				option = section.taboption(tabId, form.Flag, enableOptionName, _('Enable wireless'));
				option.rmempty = false;
				option.default = '1';
				option.cfgvalue = function() {
					return uci.get('wireless', device['.name'], 'disabled') == '1' ? '0' : '1';
				};
				option.write = function(section_id, value) {
					var ifaceName = ensureWifiIface(device['.name']);
					var disabled = value == '1' ? '0' : '1';

					uci.set('wireless', device['.name'], 'disabled', disabled);
					uci.set('wireless', ifaceName, 'disabled', disabled);
				};

				option = section.taboption(tabId, form.Value, ssidOptionName, _('SSID'));
				option.rmempty = false;
				option.cfgvalue = function() {
					var ifaceName = findWifiIface(device['.name']);
					return ifaceName ? (uci.get('wireless', ifaceName, 'ssid') || '') : '';
				};
				option.write = function(section_id, value) {
					var ifaceName = ensureWifiIface(device['.name']);
					uci.set('wireless', ifaceName, 'ssid', value);
				};

				option = section.taboption(tabId, form.ListValue, encryptionOptionName, _('Encryption'));
				option.rmempty = false;
				option.default = 'psk2';
				option.value('none', _('Open'));
				option.value('psk2', 'WPA2-PSK');
				option.value('psk-mixed', 'WPA/WPA2-PSK');
				option.value('sae', 'WPA3-SAE');
				option.value('sae-mixed', 'WPA2/WPA3-SAE');
				option.cfgvalue = function() {
					var ifaceName = findWifiIface(device['.name']);
					return ifaceName ? (uci.get('wireless', ifaceName, 'encryption') || 'psk2') : 'psk2';
				};
				option.write = function(section_id, value) {
					var ifaceName = ensureWifiIface(device['.name']);

					uci.set('wireless', ifaceName, 'encryption', value);
					if (value == 'none')
						uci.unset('wireless', ifaceName, 'key');
				};

				option = section.taboption(tabId, form.Value, keyOptionName, _('Password'));
				option.password = true;
				option.rmempty = false;
				option.datatype = 'wpakey';
				option.cfgvalue = function() {
					var ifaceName = findWifiIface(device['.name']);
					return ifaceName ? (uci.get('wireless', ifaceName, 'key') || '') : '';
				};
				option.write = function(section_id, value) {
					var ifaceName = ensureWifiIface(device['.name']);
					var encryption = uci.get('wireless', ifaceName, 'encryption') || 'psk2';

					if (encryption != 'none')
						uci.set('wireless', ifaceName, 'key', value);
				};
				option.depends(encryptionOptionName, 'psk2');
				option.depends(encryptionOptionName, 'psk-mixed');
				option.depends(encryptionOptionName, 'sae');
				option.depends(encryptionOptionName, 'sae-mixed');
			});
		}

		return map.render().then(function(mapEl) {
			panel.appendChild(mapEl);

			return self.renderStatus(statusContainer).then(function() {
				poll.add(function() {
					return self.renderStatus(statusContainer);
				});

				return panel;
			});
		});
	},

	handleSave: function(ev) {
		return this.map.save(ev);
	},

	handleSaveApply: function(ev) {
		return this.handleSave(ev).then(function() {
			return ui.changes.apply();
		});
	},

	handleReset: function(ev) {
		return this.map.reset(ev);
	}
});