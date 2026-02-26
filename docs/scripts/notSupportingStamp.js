nez = {

    pfrs: [
        [
            "did not support",
            "do not support",
            "will not support"
        ],
        [
            "did not support",
            "do not support",
            "will not support"
        ],
        [
            "did not support",
            "do not support",
            "will not support"
        ],
        [
            "did not support",
            "do not support",
            "will not support"
        ],
        [
            "I  DO",
            "NOT",
            "SUPPORT THIS"
        ],
        [
            "I AM AGAINST",
            "I AM AGAINST",
            "I AM AGAINST"
        ],
    ],

    l_days: ['days', 'day', 'days'],
    l_years: ['years', 'year', 'years'],
    pad: function (n) {
        if (n % 100 < 11 || n % 100 > 14) {
            if (n % 10 === 1) return 1;
            if (n % 10 >= 2 && n % 10 <= 4) return 2;
        }
        return 0;
    },

    yd: function (t) {
        const from = new Date(t);
        const now = new Date();
        let years = now.getFullYear() - from.getFullYear();
        let anniversary = new Date(from);
        anniversary.setFullYear(from.getFullYear() + years);
        if (anniversary > now) { years--; anniversary.setFullYear(from.getFullYear() + years); }
        const msPerDay = 24 * 60 * 60 * 1000;
        const days = Math.floor((now - anniversary) / msPerDay);
        return { years, days };
    },

    rxy: function (r, x, y) {
        return `<div style='
		transform:rotate(${r}deg);
		top:${x}px;
		left:${y}px;
		${nez.cc}'
	    align='center'>${nez.lin1}
        <div style='height:22px;vertical-align:center;'>`;
    },

    start: function () {

        nez.cc = "color:#2F69C2;position:absolute;";
        const lin = "border-bottom: 2px solid #2F69C2;";
        nez.lin1 = `<div style='${lin}width:200px;'></div>`;
        nez.lin2 = `</div><div style='${lin}width:115px;'></div></div>`;

        let t = nez.pfrs[Math.floor(Math.random() * nez.pfrs.length)];
        let xdat = nez.yd(1645650000000);

        let o = `
<div style='overflow:hidden;width:100%;height:300px;position:absolute;top:0;left:0;pointer-events:none;'>
    <div id='nez2'
style='width:200px;height:200px;padding-right:20px;pointer-events:none;position:absolute;top:0;right:0;z-index:30;'>
${nez.rxy(-60, 92, -38) + t[0] + nez.lin2}
${nez.rxy(60, 92, 40) + t[1] + nez.lin2}
${nez.rxy(180, 160, 0) + t[2] + nez.lin2}
    <div style='${nez.cc}top:85px;left:0;width:200px;line-height:22px;' align='center'>
	<div style='font-size:37px'>${xdat.years}</div>
	<div style='font-size:23px'>${nez.l_years[nez.pad(xdat.years)]}</div>
	<div style='font-size:18px'>${xdat.days} ${nez.l_days[nez.pad(xdat.days)]}</div>
    </div>
    </div>
</div>`;
        setTimeout(function () {
            const parent = document.querySelector('#mainContent') || document.body;
            const d = document.createElement('div');
            d.innerHTML = o;
            parent.appendChild(d);

            let e = document.querySelector('#nez2');
            setTimeout(function () {
                e.style.transitionDuration = '0.5s';
                e.style.transform = `rotate(${(Math.floor(Math.random() * 360))}deg)`;
            }, 10);
        }, 1000);
    },
};

document.addEventListener('DOMContentLoaded', nez.start);