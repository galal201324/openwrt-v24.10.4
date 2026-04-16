'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require rpc';
'require dom';
'require poll';
'require fs';

var callInitAction = rpc.declare({
	object: 'luci',
	method: 'setInitAction',
	params: [ 'name', 'action' ],
	expect: { result: false }
});

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('setup'),
			uci.load('network'),
			uci.load('wireless'),
			uci.load('dhcp'),
			uci.load('system')
		]);
	},

	render: function() {
		var m, s, o;

		m = new form.Map('setup', _('Quick Setup'), _('Quick router configuration — change common settings from one page.'));

		/* ── Section: LAN Settings ── */
		s = m.section(form.NamedSection, 'default', 'setup', _('LAN Settings'));
		s.anonymous = false;
		s.addremove = false;

		o = s.option(form.Value, 'lan_ipaddr', _('LAN IP Address'),
			_('The IP address of the router on the LAN side.'));
		o.datatype = 'ip4addr';
		o.placeholder = '192.168.1.1';
		o.rmempty = false;

		o = s.option(form.Value, 'lan_netmask', _('LAN Netmask'),
			_('The subnet mask for the LAN network.'));
		o.datatype = 'ip4addr';
		o.placeholder = '255.255.255.0';
		o.rmempty = false;

		o = s.option(form.ListValue, 'AlwSettings', _('Settings Mode'));
		o.value('AL', _('ALemprator (Default)'));
		o.value('manual', _('Manual'));
		o.default = 'AL';

		/* ── Section: Quick Network (direct UCI on network config) ── */
		var net = new form.Map('network', _('Network Configuration'));

		s = net.section(form.NamedSection, 'lan', 'interface', _('LAN Interface'));
		s.anonymous = false;
		s.addremove = false;

		o = s.option(form.Value, 'ipaddr', _('LAN IP Address (network)'),
			_('This is the actual network interface IP address.'));
		o.datatype = 'ip4addr';
		o.placeholder = '192.168.1.1';

		o = s.option(form.Value, 'netmask', _('LAN Netmask (network)'));
		o.datatype = 'ip4addr';
		o.placeholder = '255.255.255.0';

		o = s.option(form.Value, 'gateway', _('Default Gateway'));
		o.datatype = 'ip4addr';
		o.optional = true;

		o = s.option(form.DynamicList, 'dns', _('DNS Servers'));
		o.datatype = 'ip4addr';
		o.optional = true;

		/* ── Section: Quick System ── */
		var sys = new form.Map('system', _('System Configuration'));

		s = sys.section(form.TypedSection, 'system', _('System'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Value, 'hostname', _('Hostname'));
		o.datatype = 'hostname';
		o.placeholder = 'OpenWrt';

		o = s.option(form.ListValue, 'zonename', _('Timezone'));
		o.value('UTC', 'UTC');
		o.value('Asia/Riyadh', 'Asia/Riyadh');
		o.value('Asia/Baghdad', 'Asia/Baghdad');
		o.value('Asia/Dubai', 'Asia/Dubai');
		o.value('Africa/Cairo', 'Africa/Cairo');
		o.value('Asia/Aden', 'Asia/Aden');
		o.value('Asia/Beirut', 'Asia/Beirut');
		o.value('Asia/Damascus', 'Asia/Damascus');
		o.value('Asia/Amman', 'Asia/Amman');
		o.value('Africa/Tripoli', 'Africa/Tripoli');
		o.value('Africa/Tunis', 'Africa/Tunis');
		o.value('Africa/Algiers', 'Africa/Algiers');
		o.value('Africa/Casablanca', 'Africa/Casablanca');
		o.value('Asia/Kuwait', 'Asia/Kuwait');
		o.value('Asia/Muscat', 'Asia/Muscat');
		o.value('Europe/London', 'Europe/London');
		o.value('Europe/Berlin', 'Europe/Berlin');
		o.value('America/New_York', 'America/New_York');
		o.optional = true;

		/* ── Section: Quick Wireless ── */
		var wifi = new form.Map('wireless', _('Wireless Configuration'));

		s = wifi.section(form.TypedSection, 'wifi-iface', _('Wireless Interfaces'));
		s.anonymous = false;
		s.addremove = false;

		o = s.option(form.Value, 'ssid', _('SSID (Network Name)'));
		o.datatype = 'maxlength(32)';

		o = s.option(form.ListValue, 'encryption', _('Encryption'));
		o.value('none', _('No Encryption'));
		o.value('psk2', 'WPA2-PSK');
		o.value('psk-mixed', 'WPA/WPA2-PSK Mixed');
		o.value('sae', 'WPA3-SAE');
		o.value('sae-mixed', 'WPA2/WPA3-SAE Mixed');

		o = s.option(form.Value, 'key', _('Wireless Password'));
		o.datatype = 'wpakey';
		o.password = true;
		o.depends('encryption', 'psk2');
		o.depends('encryption', 'psk-mixed');
		o.depends('encryption', 'sae');
		o.depends('encryption', 'sae-mixed');

		o = s.option(form.Flag, 'disabled', _('Disable this interface'));
		o.enabled = '1';
		o.disabled = '0';
		o.default = '0';

		/* ── Section: Quick DHCP ── */
		var dhcp = new form.Map('dhcp', _('DHCP Configuration'));

		s = dhcp.section(form.NamedSection, 'lan', 'dhcp', _('DHCP Server (LAN)'));
		s.anonymous = false;
		s.addremove = false;

		o = s.option(form.Value, 'start', _('DHCP Start'),
			_('First address in the DHCP pool (offset from network address).'));
		o.datatype = 'uinteger';
		o.placeholder = '100';

		o = s.option(form.Value, 'limit', _('DHCP Limit'),
			_('Number of addresses in the DHCP pool.'));
		o.datatype = 'uinteger';
		o.placeholder = '150';

		o = s.option(form.Value, 'leasetime', _('Lease Time'),
			_('Expiry time of DHCP leases, e.g. 12h or 30m.'));
		o.placeholder = '12h';

		return Promise.all([
			m.render(),
			net.render(),
			sys.render(),
			wifi.render(),
			dhcp.render()
		]).then(function(nodes) {
			var container = E('div', {}, nodes);
			return container;
		});
	},

	handleSaveApply: function(ev, mode) {
		return this.handleSave(ev).then(function() {
			ui.changes.apply(mode == '0');
		});
	},

	handleSave: function(ev) {
		var tasks = [];

		document.getElementById('maincontent')
			.querySelectorAll('.cbi-map').forEach(function(map) {
				tasks.push(dom.callClassMethod(map, 'save'));
			});

		return Promise.all(tasks);
	},

	handleReset: function(ev) {
		var tasks = [];

		document.getElementById('maincontent')
			.querySelectorAll('.cbi-map').forEach(function(map) {
				tasks.push(dom.callClassMethod(map, 'reset'));
			});

		return Promise.all(tasks);
	}
});
